// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IBaseAdapter} from "./adapters/interfaces/IBaseAdapter.sol";
import {IController} from "./interfaces/IController.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";

/**
 * @title MessageControllerUpgradeable
 * @notice Manages message relaying between chains (two-way) with a consensus mechanism, using compliant bridge adapters to relay a message.
 * @dev This contract inherits from Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, and implements IController.
 */
contract MessageControllerUpgradeable is Initializable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, IController {
    /// @notice Event emitted when a message originator is set or updated.
    /// @param originator The address of the message originator.
    /// @param enabled A boolean indicating whether the originator is enabled or disabled.
    event MessageOriginatorSet(address indexed originator, bool enabled);

    /// @notice Event emitted when a message resender is set or updated.
    /// @param resender The address of the message resender.
    /// @param enabled A boolean indicating whether the resender is enabled or disabled.
    event MessageResenderSet(address indexed resender, bool enabled);

    /// @notice Event emitted when a message is relayed.
    /// @param messageId The unique identifier of the message.
    /// @param bridge The address of the bridge that relayed the message.
    event MessageRelayed(bytes32 indexed messageId, address bridge);

    /// @notice Event emitted when a message is created.
    /// @param messageId The unique identifier of the message.
    /// @param chainId The ID of the destination chain.
    /// @param threshold The threshold required for the message to be executed.
    event MessageCreated(bytes32 indexed messageId, uint256 chainId, uint256 threshold);

    /// @notice Event emitted when a message is resent.
    /// @param messageId The unique identifier of the message.
    event MessageResent(bytes32 indexed messageId);

    /// @notice Event emitted when a message is received.
    /// @param messageId The unique identifier of the message.
    /// @param bridge The address of the bridge that received the message.
    event MessageReceived(bytes32 indexed messageId, address bridge);

    /// @notice Event emitted when a message is executed.
    /// @param messageId The unique identifier of the message.
    event MessageExecuted(bytes32 indexed messageId);

    /// @notice Event emitted when a message is executable.
    /// @param messageId The unique identifier of the message.
    /// @param executableAt The timestamp at which the message can be executed.
    event MessageExecutableAt(bytes32 indexed messageId, uint256 executableAt);

    /// @notice Event emitted when a message is cancelled.
    /// @param messageId The unique identifier of the message.
    event MessageCancelled(bytes32 indexed messageId);

    /// @notice Event emitted when the local registry is set.
    /// @param localRegistry The address of the local registry.
    event LocalRegistrySet(address indexed localRegistry);

    /// @notice Event emitted when a local adapter is set.
    /// @param adapter The address of the local adapter.
    /// @param enabled A boolean indicating whether the adapter is enabled.
    event LocalAdapterSet(address indexed adapter, bool enabled);

    /// @notice Event emitted when a controller for a chain is set.
    /// @param controller The address of the controller.
    /// @param chainId The ID of the chain.
    event ControllerForChainSet(address indexed controller, uint256 chainId);

    /// @notice Event emitted when the Vetoer address is set.
    /// @param vetoer The address of the vetoer.
    event VetoerSet(address indexed vetoer);

    /// @notice Event emitted when the timelock delay is set.
    /// @param timelockDelay The timelock delay in seconds.
    event TimelockDelaySet(uint256 timelockDelay);

    /// @notice Error thrown when an unauthorized action is attempted.
    error Controller_Unauthorised();

    /// @notice Error thrown when a bridge is disabled.
    error Controller_Bridge_Disabled();

    /// @notice Error thrown when invalid parameters are provided.
    error Controller_Invalid_Params();

    /// @notice Error thrown when low level call fails during message execution
    error Controller_Call_Failed(uint256 index);

    /// @notice Error thrown when an ether transfer fails.
    error Controller_EtherTransferFailed();

    /// @notice Error thrown when a message is not executable.
    error Controller_MsgNotExecutable();

    /// @notice Error thrown when the threshold is not met for execution
    error Controller_ThresholdNotMet();

    /// @notice Error thrown when a message is not executable yet due to a timelock delay.
    error Controller_MsgNotExecutableYet(uint256);

    /// @notice Error thrown when a message is not cancellable.
    error Controller_MsgNotCancellable();

    /// @notice Error thrown when a message has expired.
    error Controller_MsgExpired();

    /// @notice Error thrown when an adapter resends a message that has already been delivered
    error Controller_MessageResentByAadapter();

    /// @notice Struct representing a received message.
    /// @dev This struct holds the details of a message received from another chain.
    struct ReceivedMessage {
        address[] targets; ///< The list of target addresses.
        bytes[] calldatas; ///< The list of calldata to be executed.
        uint256 threshold; ///< The threshold required for the message to be executed.
        uint256 receivedSoFar; ///< The number of times the message has been received.
        uint256 originChainId; ///< The ID of the origin chain.
        uint256 executableAt; ///< The timestamp at which the message can be executed.
        uint256 expiresAt; ///< The timestamp at which the message expires and cannot be executed afterwards.
        bool executed; ///< A boolean indicating whether the message has been executed.
        bool cancelled; ///< A boolean indicating whether the message has been cancelled.
    }

    /// @notice Struct representing a relayed message.
    /// @dev This struct holds the details of a message to be relayed to another chain.
    struct RelayedMessage {
        address[] targets; ///< The list of target addresses.
        bytes[] calldatas; ///< The list of calldata to be executed.
        bytes32 messageId; ///< The unique identifier of the message.
        uint256 threshold; ///< The threshold required for the message to be executed.
    }

    /// @notice Role identifier for the message originator. Users with this role can send messages.
    bytes32 public constant MESSAGE_ORIGINATOR_ROLE = keccak256("MESSAGE_ORIGINATOR_ROLE");
    bytes32 public constant MESSAGE_RESENDER_ROLE = keccak256("MESSAGE_RESENDER_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");

    /// @notice The time after which a message expires and cannot be executed.
    uint256 public constant MESSAGE_EXPIRY = 30 days;

    /// @notice Address of local registry holding adapter addresses
    address public localRegistry;

    /// @notice Nonce used in messageId calculation, increments after each calculation.
    uint256 public nonce;

    /// @notice Timelock delay in secods for message execution, after the threshold is reached.
    uint256 public timelockDelay;

    /// @notice Address of the vetoer that can cancel the execution of messages.
    address public vetoer;

    /// @notice Mapping of received messages identified by their message ID.
    mapping(bytes32 => ReceivedMessage) public receivedMessages;

    /// @notice Whitelist of local adapters used when receiving messages.
    mapping(address => bool) public isLocalAdapter;

    /// @dev Mapping of chain IDs to their respective controller addresses. This contract knows all the controllers in supported chains.
    mapping(uint256 => address) private _controllerForChain;

    /// @dev Mapping of relayed messages identified by their message ID.
    mapping(bytes32 => RelayedMessage) private _relayedMessages;

    /// @dev Mapping of message ID to destination chain ID.
    mapping(bytes32 => uint256) private _destChainForMessage;

    /// @dev Mapping of message ID to the bridge adapter that has delivered the message.
    mapping(bytes32 => mapping(address => bool)) private _deliveredBy;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /* ========== CONSTRUCTOR ========== */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract with the given parameters.
     * @notice Message originators getting the MESSAGE_ORIGINATOR_ROLE will also get the MESSAGE_RESENDER_ROLE. If you want to set them separately, use grantRole directly.
     * @param _messageOriginators The list of address that can send messages to this contract. Optional, pass an empty array to skip
     * @param _localRegistry The address of the local registry.
     * @param _adapters The list of local adapter addresses. Optional, pass an empty array to skip
     * @param _controllerChains The list of chain IDs that a message _controllerAddress contract exists and will be linked with this contract. Optional, pass an empty array to skip
     * @param _controllerAddress The address of the message controller contract that will be set for _controllerChains
     * @param _vetoer The address of the vetoer that can cancel the execution of messages. Pass address(0) to disable vetoer.
     * @param _timelockDelay The timelock delay in seconds for message execution. Pass 0 to disable timelock.
     * @param authUsers The addresses of the users that will be granted roles. The 1st element will get the DEFAULT_ADMIN_ROLE and PAUSE_ROLE, the 2nd element will get the PAUSE_ROLE.
     */
    function initialize(
        address[] memory _messageOriginators,
        address _localRegistry,
        address[] memory _adapters,
        uint256[] memory _controllerChains,
        address _controllerAddress,
        address _vetoer,
        uint256 _timelockDelay,
        address[2] memory authUsers
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _setupRole(DEFAULT_ADMIN_ROLE, authUsers[0]);
        _setupRole(PAUSE_ROLE, authUsers[0]);
        _grantRole(PAUSE_ROLE, authUsers[1]);

        if (_localRegistry != address(0)) {
            localRegistry = _localRegistry;
            emit LocalRegistrySet(_localRegistry);
        }
        if (_messageOriginators.length > 0) {
            for (uint256 i = 0; i < _messageOriginators.length; i++) {
                _grantRole(MESSAGE_ORIGINATOR_ROLE, _messageOriginators[i]);
                _grantRole(MESSAGE_RESENDER_ROLE, _messageOriginators[i]);
                emit MessageOriginatorSet(_messageOriginators[i], true);
                emit MessageResenderSet(_messageOriginators[i], true);
            }
        }
        if (_adapters.length > 0) {
            for (uint256 i = 0; i < _adapters.length; i++) {
                isLocalAdapter[_adapters[i]] = true;
                emit LocalAdapterSet(_adapters[i], true);
            }
        }

        if (_controllerChains.length > 0) {
            for (uint256 i = 0; i < _controllerChains.length; i++) {
                _controllerForChain[_controllerChains[i]] = _controllerAddress;
                emit ControllerForChainSet(_controllerAddress, _controllerChains[i]);
            }
        }

        timelockDelay = _timelockDelay;
        vetoer = _vetoer;

        emit VetoerSet(_vetoer);
        emit TimelockDelaySet(_timelockDelay);
    }

    /* ========== PUBLIC ========== */

    /**
     * @notice Sends a message to another chain.
     * @dev Can be called by the message originator (EOA or Contract) to send a message to another chain
     * @param relayedMsg An instance of RelayedMessage struct to be relayed.
     * @param destChainId The destination chain ID.
     * @param adapters The list of adapters addresses. Adapters provided must support the destination chain id
     * @param fees The list of fees for each adapter. Must have the same length as adapters
     */
    function sendMessage(
        RelayedMessage memory relayedMsg,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) public payable nonReentrant whenNotPaused onlyRole(MESSAGE_ORIGINATOR_ROLE) {
        // create message id
        bytes32 messageId = calculateMessageId(destChainId);
        // Increment nonce used to create message id
        nonce++;

        // Check that targets and calldatas arrays of relayed message have the same length
        if (relayedMsg.targets.length != relayedMsg.calldatas.length) revert Controller_Invalid_Params();

        // Revert if threshold is higher than the number of adapters that will execute the message
        if (adapters.length < relayedMsg.threshold) revert Controller_Invalid_Params();

        RelayedMessage memory sentMessage = RelayedMessage({
            targets: relayedMsg.targets,
            calldatas: relayedMsg.calldatas,
            messageId: messageId,
            threshold: relayedMsg.threshold
        });

        // store message
        _relayedMessages[messageId] = sentMessage;
        _destChainForMessage[messageId] = destChainId;

        // relay message
        _relayMessage(sentMessage, destChainId, adapters, fees, options);
        emit MessageCreated(messageId, destChainId, relayedMsg.threshold);
    }

    /**
     * @notice Resends a previously sent message from the same controller message to another chain.
     * @dev Must be called by an account with the message resender role.
     * @param messageId The unique identifier of the message.
     * @param adapters The list of adapter addresses.
     * @param fees The list of fees for each adapter.
     */
    function resendMessage(
        bytes32 messageId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) public payable nonReentrant whenNotPaused onlyRole(MESSAGE_RESENDER_ROLE) {
        uint256 destChainId = _destChainForMessage[messageId];
        if (destChainId == 0) revert Controller_Invalid_Params();
        _relayMessage(_relayedMessages[messageId], destChainId, adapters, fees, options);
        emit MessageResent(messageId);
    }

    /**
     * @notice Registers a received message.
     * @dev Can be called by an adapter contract only
     * @param receivedMsg The received message data in bytes.
     * @param originChain The origin chain ID.
     * @param originSender The address of the origin sender. (controller in origin chain)
     */
    function receiveMessage(bytes calldata receivedMsg, uint256 originChain, address originSender) public override nonReentrant {
        // msg sender should be an adapter contract
        if (!isSenderApproved(msg.sender)) revert Controller_Unauthorised();

        // originSender must be a controller on another chain
        if (getControllerForChain(originChain) != originSender) revert Controller_Invalid_Params();

        // decode message
        RelayedMessage memory message = abi.decode(receivedMsg, (RelayedMessage));
        ReceivedMessage memory receivedMessage = receivedMessages[message.messageId];

        if (_deliveredBy[message.messageId][msg.sender] == true) revert Controller_MessageResentByAadapter();
        _deliveredBy[message.messageId][msg.sender] = true;

        emit MessageReceived(message.messageId, msg.sender);

        // if message id does not exist
        if (receivedMessage.receivedSoFar == 0) {
            receivedMessage = ReceivedMessage({
                targets: message.targets,
                calldatas: message.calldatas,
                threshold: message.threshold,
                receivedSoFar: 1,
                originChainId: originChain,
                executableAt: 0,
                expiresAt: block.timestamp + MESSAGE_EXPIRY,
                executed: false,
                cancelled: false
            });
        } else {
            // if message id exists
            receivedMessage.receivedSoFar += 1;
        }

        // Check if the message can be executed
        if ((receivedMessage.receivedSoFar >= receivedMessage.threshold) && (receivedMessage.expiresAt > block.timestamp)) {
            receivedMessage.executableAt = block.timestamp + timelockDelay;
            emit MessageExecutableAt(message.messageId, receivedMessage.executableAt);
        }
        receivedMessages[message.messageId] = receivedMessage;
    }

    /**
     * @notice Executes a received message. Anyone can execute a message
     * @param messageId The unique identifier of the message.
     */
    function execute(bytes32 messageId) public nonReentrant whenNotPaused {
        ReceivedMessage storage message = receivedMessages[messageId];
        if (message.executed || message.cancelled) revert Controller_MsgNotExecutable();
        if (message.executableAt > block.timestamp) revert Controller_MsgNotExecutableYet(message.executableAt);
        if (message.expiresAt < block.timestamp) revert Controller_MsgExpired();

        if (message.receivedSoFar >= message.threshold) {
            message.executed = true;
            _execute(message.targets, message.calldatas);
            emit MessageExecuted(messageId);
        } else {
            revert Controller_ThresholdNotMet();
        }
    }

    function cancel(bytes32 messageId) public nonReentrant {
        if (msg.sender != vetoer) revert Controller_Unauthorised();
        ReceivedMessage storage message = receivedMessages[messageId];
        if (message.executed || message.cancelled || (message.receivedSoFar == 0)) revert Controller_MsgNotCancellable();

        message.cancelled = true;
        emit MessageCancelled(messageId);
    }

    /* ========== VIEW ========== */

    /**
     * @notice Returns the controller address for a given chain ID.
     * @param chainId The chain ID.
     * @return The controller address.
     */
    function getControllerForChain(uint256 chainId) public view override returns (address) {
        return _controllerForChain[chainId];
    }

    /**
     * @notice Checks if a sender is approved.
     * @dev If a registry is set, then the check happens on the registry, otherwise it reads local storage.
     * @dev If local registry is set to address zero, then local storage is used.
     * @return True if the sender is approved, false otherwise.
     */
    function isSenderApproved(address sender) public view returns (bool) {
        if (localRegistry != address(0)) {
            return IRegistry(localRegistry).isLocalAdapter(sender);
        } else {
            return isLocalAdapter[sender];
        }
    }

    /**
     * @notice Calculates the message ID based on the provided parameters.
     * @param destChainId The destination chain ID.
     * @return The calculated message ID.
     */
    function calculateMessageId(uint256 destChainId) public view returns (bytes32) {
        return keccak256(abi.encode(destChainId, block.chainid, nonce));
    }

    /**
     * @notice Checks if a received message is executable.
     * @param messageId The unique identifier of the message.
     * @return True if the message is executable, false otherwise.
     */
    function isReceivedMessageExecutable(bytes32 messageId) public view returns (bool) {
        ReceivedMessage memory message = receivedMessages[messageId];
        return
            !(message.receivedSoFar == 0 && message.threshold == 0 && !message.executed) &&
            (message.receivedSoFar >= message.threshold) &&
            (message.expiresAt > block.timestamp) &&
            !message.executed &&
            !message.cancelled &&
            (message.executableAt <= block.timestamp);
    }

    /* ========== ADMIN ========== */

    /**
     * @notice Sets the local adapters.
     * @dev Local adapters can be updated only by the owner.
     * @param adapters The list of adapter addresses.
     * @param enabled The list of boolean values indicating whether each adapter is enabled.
     */
    function setLocalAdapter(address[] memory adapters, bool[] memory enabled) public onlyRole(DEFAULT_ADMIN_ROLE) {
        // A local registry address supersede the local adapters list
        if (adapters.length != enabled.length) revert Controller_Invalid_Params();
        for (uint256 i = 0; i < adapters.length; i++) {
            isLocalAdapter[adapters[i]] = enabled[i];
            emit LocalAdapterSet(adapters[i], enabled[i]);
        }
    }

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
     * @notice Sets the message originator addresses that can send messages to other chains.
     * @notice Originators being granted/revoked the MESSAGE_ORIGINATOR_ROLE will also be granted/revoked the MESSAGE_RESENDER_ROLE.
     * @notice If you want to grant/revoke roles separately, use grantRole/revokeRole directly.
     * @param originators The list of addresses of the message originators.
     * @param enabled The list of boolean values indicating whether each originator is enabled or disabled.
     */
    function setMessageOriginators(address[] memory originators, bool[] memory enabled) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (originators.length != enabled.length) revert Controller_Invalid_Params();
        for (uint256 i = 0; i < originators.length; i++) {
            if (enabled[i]) {
                _grantRole(MESSAGE_ORIGINATOR_ROLE, originators[i]);
                _grantRole(MESSAGE_RESENDER_ROLE, originators[i]);
            } else {
                _revokeRole(MESSAGE_ORIGINATOR_ROLE, originators[i]);
                _revokeRole(MESSAGE_RESENDER_ROLE, originators[i]);
            }
            emit MessageOriginatorSet(originators[i], enabled[i]);
            emit MessageResenderSet(originators[i], enabled[i]);
        }
    }

    /**
     * @notice Sets the controller addresses for the given chain IDs.
     * @param chainId The list of chain IDs.
     * @param controller The list of controller addresses.
     */
    function setControllerForChain(uint256[] memory chainId, address[] memory controller) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (chainId.length != controller.length) revert Controller_Invalid_Params();
        for (uint256 i = 0; i < chainId.length; i++) {
            _controllerForChain[chainId[i]] = controller[i];
            emit ControllerForChainSet(controller[i], chainId[i]);
        }
    }

    /**
     * @notice Sets the vetoer address that can cancel the execution of messages. Set to address(0) to disable vetoer.
     * @param _vetoer The address of the vetoer.
     */
    function setVetoer(address _vetoer) public onlyRole(DEFAULT_ADMIN_ROLE) {
        vetoer = _vetoer;
        emit VetoerSet(_vetoer);
    }

    /**
     * @notice Sets the timelock delay in seconds for message execution. Set to 0 to disable timelock.
     * @param _timelockDelay The timelock delay in seconds.
     */
    function setTimelockDelay(uint256 _timelockDelay) public onlyRole(DEFAULT_ADMIN_ROLE) {
        timelockDelay = _timelockDelay;
        emit TimelockDelaySet(_timelockDelay);
    }

    /// @notice Withdraws the contract balance to the recipient address.
    /// @dev Only the owner can call this function.
    /// @param recipient The address to which the contract balance will be transferred.
    function withdraw(address payable recipient) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert Controller_Invalid_Params();

        (bool success, ) = recipient.call{value: address(this).balance}("");
        if (!success) revert Controller_EtherTransferFailed();
    }

    /// @notice Pauses the contract.
    /// @dev Only the admin can call this function.
    function pause() public onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /// @notice Unpauses the contract.
    /// @dev Only the admin can call this function.
    function unpause() public onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    /* ========== INTERNAL ========== */

    /**
     * @notice Relays a message to another chain.
     * @notice Msg.sender will receive any refunds from excess fees paid by the bridge, if the bridge supports it.
     * @param relayedMsg The RelayedMessage struct with the date to be relayed.
     * @param destChainId The destination chain ID.
     * @param adapters The list of adapter addresses.
     * @param fees The list of fees for each adapter.
     */
    function _relayMessage(
        RelayedMessage memory relayedMsg,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) internal {
        if ((adapters.length != fees.length) || (adapters.length != options.length)) revert Controller_Invalid_Params();

        for (uint256 i = 0; i < adapters.length; i++) {
            IBaseAdapter(adapters[i]).relayMessage{value: fees[i]}(
                destChainId,
                getControllerForChain(destChainId),
                options[i],
                abi.encode(relayedMsg)
            );
            emit MessageRelayed(relayedMsg.messageId, adapters[i]);
        }
    }

    /**
     * @notice Executes the given targets with the provided calldata.
     * @param targets The list of target addresses.
     * @param calldatas The list of calldata to be executed.
     */
    function _execute(address[] memory targets, bytes[] memory calldatas) internal {
        for (uint256 i = 0; i < targets.length; ++i) {
            (bool success, ) = targets[i].call(calldatas[i]);
            if (!success) revert Controller_Call_Failed(i);
        }
    }

    ///@dev Fallback function to receive ether from bridge refunds
    receive() external payable {}
}
