// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ECDSAUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IVotingController} from "./interfaces/IVotingController.sol";
import {IGovernor} from "../governor/interfaces/IGovernor.sol";
import {IVotingToken} from "../governor/interfaces/IVotingToken.sol";
import {IBaseAdapter} from "../../modules/chain-abstraction/adapters/interfaces/IBaseAdapter.sol";
import {IController} from "../../modules/chain-abstraction/interfaces/IController.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";

/**
 * @title VotingControllerUpgradeable
 * @notice The VotingController contract is used to relay votes from one chain to another chain where a Governor contract resides.
 */
contract VotingControllerUpgradeable is
    Initializable,
    EIP712Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    IVotingController,
    IController
{
    /* ========== EVENTS ========== */

    event CrossChainVoteCast(address voter, address governor, uint256 proposalId);
    event CrossChainVoteRelayed(address bridgeAdapter, bytes32 transferId, address voter, address governor, uint256 proposalId);
    event ControllerForChainSet(address indexed controller, uint256 chainId);
    event LocalRegistrySet(address indexed localRegistry);

    /* ========== ERRORS ========== */
    error Controller_InvalidVoteParams();
    error Controller_InvalidBridgeParams();
    error Controller_InvalidParams();
    error Controller_OriginUnauthorised();
    error Controller_EtherTransferFailed();

    /* ========== STATE VARIABLES ========== */
    bytes32 public constant VOTE_TYPEHASH = keccak256("Vote(address destGovernor,uint256 chainId,uint256 proposalId,uint8 support,bytes voteData)");

    /// @notice Role to pause the contract
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");

    /// @notice Address of local registry holding adapter addresses
    address public localRegistry;

    // Returns controller contract address for a given chain id. The contract knows all other controllers in other chains
    mapping(uint256 => address) private _controllerForChain;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /* ========== CONSTRUCTOR ========== */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     *
     * @notice Initializes the VotingController contract.
     * @param controllers Array of controller addresses for different chains.
     * @param chains Array of chain IDs corresponding to the controller addresses. Optional.
     * @param _localRegistry Address of the local registry. Optional.
     * @param _owner Address of the owner.
     */
    function initialize(address[] memory controllers, uint256[] memory chains, address _localRegistry, address _owner) public initializer {
        __EIP712_init("VotingController", "1");
        __Pausable_init();
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, _owner);
        _setupRole(PAUSE_ROLE, _owner);

        if (controllers.length > 0) {
            if (controllers.length != chains.length) revert Controller_InvalidParams();
            for (uint256 i = 0; i < controllers.length; i++) {
                _controllerForChain[chains[i]] = controllers[i];
                emit ControllerForChainSet(controllers[i], chains[i]);
            }
        }
        if (_localRegistry == address(0)) revert Controller_InvalidParams();
        localRegistry = _localRegistry;
        emit LocalRegistrySet(_localRegistry);
    }

    /* ========== PUBLIC FUNCTIONS ========== */

    /**
     * @notice Returns a hash of the given parameters.
     * @param destGovernor The address of the Governor contract on the destination chain.
     * @param chainId The chain ID of the destination chain.
     * @param proposalId The ID of the proposal.
     * @param support The vote option.
     * @param voteData Additional vote data. Optional
     */
    function getMessageHash(
        address destGovernor,
        uint256 chainId,
        uint256 proposalId,
        uint8 support,
        bytes memory voteData
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, destGovernor, chainId, proposalId, support, keccak256(voteData)));
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Function called by users to initiate a vote relay to another chain.
     * @param _calldata The RelayParams struct containing the necessary parameters for the relay.
     */
    function relayVote(RelayParams calldata _calldata) public payable override whenNotPaused {
        // The controller contract on the other chain that the vote will eventually be forwarded to
        address foreignController = getControllerForChain(_calldata.chainId);
        if (foreignController == address(0)) revert Controller_InvalidBridgeParams(); // Adapter not deployed in this chain, revert
        // Recover the voter address
        address voter;
        {
            bytes32 encodedVote = getMessageHash(
                _calldata.destGovernor,
                _calldata.chainId,
                _calldata.sigVoteParams.proposalId,
                _calldata.sigVoteParams.support,
                _calldata.sigVoteParams.voteData
            );
            voter = ECDSAUpgradeable.recover(ECDSAUpgradeable.toEthSignedMessageHash(encodedVote), _calldata.sigVoteParams.signature);
        }

        // call getVote() with computed voter address and timestamp on native token
        uint256 votes = IVotingToken(_calldata.sourceToken).getPastVotes(voter, _calldata.timepoint);
        // if zero, revert
        if (votes == 0) revert Controller_InvalidVoteParams();

        // prepare RelayedMessage struct
        RelayedMessage memory message = RelayedMessage(
            _calldata.destGovernor,
            _calldata.sourceToken,
            voter,
            _calldata.timepoint,
            votes,
            _calldata.sigVoteParams.proposalId,
            _calldata.sigVoteParams.support,
            _calldata.sigVoteParams.voteData
        );

        bytes32 transferId = IBaseAdapter(_calldata.adapter).relayMessage{value: msg.value}(
            _calldata.chainId,
            foreignController,
            _calldata.options,
            abi.encode(message)
        );

        emit CrossChainVoteRelayed(_calldata.adapter, transferId, voter, message.governor, _calldata.sigVoteParams.proposalId);
    }

    /**
     * @notice Registers a received message. Can be called by the bridge adapter.
     * @param receivedMsg The received message data in bytes.
     * @param originChain The origin chain ID.
     * @param originSender The address of the origin sender. (controller in origin chain)
     */
    function receiveMessage(bytes calldata receivedMsg, uint256 originChain, address originSender) public {
        // msg sender should be an adapter contract
        if (!isSenderApproved(msg.sender)) revert Controller_OriginUnauthorised();

        // originSender must be a controller on another chain
        if (getControllerForChain(originChain) != originSender) revert Controller_InvalidParams();

        RelayedMessage memory message = abi.decode(receivedMsg, (RelayedMessage));

        // call custom function on governor to vote directly
        IGovernor(message.governor).castCrossChainVote(
            originChain,
            message.voter,
            message.voteWeight,
            message.sourceToken,
            message.timepoint,
            message.proposalId,
            message.support,
            message.voteData
        );

        // emit event
        emit CrossChainVoteCast(message.voter, message.governor, message.proposalId);
    }

    /* ========== VIEW ========== */

    /**
     * @notice Returns the controller address for a given chain ID.
     * @param chainId The chain ID.
     * @return The controller address.
     */
    function getControllerForChain(uint256 chainId) public view returns (address) {
        return _controllerForChain[chainId];
    }

    /**
     * @notice Checks if a sender is approved.
     * @dev If a registry is set, then the check happens on the registry, otherwise it reads local storage.
     * @dev If local registry is set to address zero, then local storage is used.
     * @return True if the sender is approved, false otherwise.
     */
    function isSenderApproved(address sender) public view returns (bool) {
        return IRegistry(localRegistry).isLocalAdapter(sender);
    }

    /* ========== ADMIN ========== */

    /**
     * @notice Sets the local registry address.
     * @dev Local adapters can be updated only by the owner.
     * @param _localRegistry The address of the local registry.
     */
    function setLocalRegistry(address _localRegistry) public onlyRole(DEFAULT_ADMIN_ROLE) {
        localRegistry = _localRegistry;
        emit LocalRegistrySet(_localRegistry);
    }

    /**
     * @notice Sets multiple controller addresses for different chains.
     * @dev Only the owner can call this function.
     * @param chainId A list of chain IDs.
     * @param controller A list of controller addresses.
     */
    function setControllerForChain(uint256[] memory chainId, address[] memory controller) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (chainId.length != controller.length) revert Controller_InvalidParams();
        for (uint256 i = 0; i < chainId.length; i++) {
            _controllerForChain[chainId[i]] = controller[i];
            emit ControllerForChainSet(controller[i], chainId[i]);
        }
    }

    /**
     * @notice Pauses the contract
     * @dev Only the owner can call this function.
     */
    function pause() external onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     * @dev Only the owner can call this function.
     */
    function unpause() external onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    /**
     * @notice Withdraws the contract balance to the recipient address.
     * @dev Only the owner can call this function.
     * @param recipient The address to which the contract balance will be transferred.
     */
    function withdraw(address payable recipient) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert Controller_InvalidParams();

        (bool success, ) = recipient.call{value: address(this).balance}("");
        if (!success) revert Controller_EtherTransferFailed();
    }

    ///@dev Fallback function to receive ether from bridge refunds
    receive() external payable {}
}
