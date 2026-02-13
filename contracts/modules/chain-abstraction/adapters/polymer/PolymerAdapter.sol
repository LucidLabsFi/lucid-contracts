// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ICrossL2ProverV2} from "./interfaces/ICrossL2ProverV2.sol";
import {BaseAdapter} from "../BaseAdapter.sol";

/// @title Polymer Adapter
/// @notice Adapter contract for cross-chain communication using the Polymer protocol.
contract PolymerAdapter is BaseAdapter, ReentrancyGuard {
    /// @notice Event emitted when a chain ID has been set
    event ChainIdSet(uint256 chainId, bool enabled);

    /// @notice Event emitted when a message is ready to be relayed.
    event RelayViaPolymer(uint256 indexed destChainId, address indexed destAdapter, bytes32 indexed transferId, bytes message);

    /// @notice Error messages when quoted fee after deductions is too low
    error Adapter_FeeTooLow(uint256 minGas, uint256 amount);

    /// @notice Error when the proof is invalid.
    error Adapter_InvalidProof();

    /// @notice Event hash for the RelayViaPolymer event.
    bytes32 public constant RELAY_EVENT_HASH = keccak256("RelayViaPolymer(uint256,address,bytes32,bytes)");

    /// @notice Nonce used in transferId calculation, increments after each calculation.
    uint256 public nonce;

    /// @notice Address of the Polymer Prover contract on the same chain.
    ICrossL2ProverV2 public immutable PROVER;

    /// @notice Maps accesible Polymer chains IDs.
    mapping(uint256 => bool) public supportedChainIds;

    /// @notice Constructor to initialize the PolymerAdapter.
    /// @param _prover Address of the Polymer prover contract on the same chain.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message. Acts as a fixed protocol fee.
    /// @param treasury Address of the treasury.
    /// @param chainIds Array of chain IDs supported by the adapter.
    /// @param owner Owner of the adapter
    constructor(
        address _prover,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint256[] memory chainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, 0, owner) {
        if (_prover == address(0)) revert Adapter_InvalidParams();
        PROVER = ICrossL2ProverV2(_prover);
        for (uint256 i = 0; i < chainIds.length; i++) {
            supportedChainIds[chainIds[i]] = true;
            emit ChainIdSet(chainIds[i], true);
        }
    }

    /// @notice Emits an event to be relayed to a destination chain using Polymer.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Refunds back to refundAddress any excess gas fees. Returned value is always 0 since no id is produced, should be ignored.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param options Additional params to be used by the adapter, abi encoded refund address.
    /// @param message The message data to be relayed.
    /// @return transferId Transfer ID of the relayed message.
    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes memory message
    ) external payable override whenNotPaused nonReentrant returns (bytes32 transferId) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        address destAdapter = trustedAdapters[destChainId];
        if (!supportedChainIds[destChainId] || destAdapter == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        bytes memory relayedMessage = abi.encode(BridgedMessage(message, msg.sender, destination));
        _collectAndRefundFees(abi.decode(options, (address)));

        transferId = calculateTransferId(destChainId);
        // Increment nonce used to create transfer id
        nonce++;

        // emit event
        emit RelayViaPolymer(destChainId, destAdapter, transferId, relayedMessage);
    }

    /// @notice Receives a message.
    /// @param proof A hex encoded proof from Polymer.
    function receiveMessage(bytes calldata proof) external virtual whenNotPaused {
        (uint32 originChainId, address sourceAdapter, bytes memory topics, bytes memory unindexedData) = PROVER.validateEvent(proof);
        if (topics.length != 128) revert Adapter_InvalidProof();
        // If proof is invalid, PROVER.validateEvent() reverts
        address originAdapter = trustedAdapters[originChainId];

        // Decode and verify indexed topics (dest chain id and dest adapter are the same)
        (bytes32 eventHash, uint256 destChainId, address destAdapter, bytes32 transferId) = abi.decode(topics, (bytes32, uint256, address, bytes32));
        if (((destAdapter != address(this)) || (destChainId != block.chainid)) || (originAdapter == address(0)) || (eventHash != RELAY_EVENT_HASH))
            revert Adapter_InvalidProof();

        _registerMessage(sourceAdapter, transferId, abi.decode(unindexedData, (bytes)), originChainId);
    }

    /**
     * @notice Calculates the transfer ID based on the provided parameters.
     * @param destChainId The destination chain ID.
     * @return The calculated transfer ID.
     */
    function calculateTransferId(uint256 destChainId) public view returns (bytes32) {
        return keccak256(abi.encode(destChainId, block.chainid, nonce));
    }

    /// @dev Internal function to collect fees and refund the difference if necessary
    /// @param refundAddress The user address to receive a refund
    function _collectAndRefundFees(address refundAddress) internal {
        uint256 remainingValue = _deductMinGas(msg.value);
        if (remainingValue != 0) {
            // refund excess
            (bool success, ) = refundAddress.call{value: remainingValue}("");
            if (!success) revert Adapter_FeeTransferFailed();
        }
    }

    /// @notice Deducts the protocol fee from the given amount
    /// @dev Internal function that collects the minimumGas and transfers it to the protocol fee recipient
    /// @param amount The amount from which the fee will be deducted
    /// @return The amount after deducting the fee (remaining value)
    function _deductMinGas(uint256 amount) internal returns (uint256) {
        if (amount < minGas && minGas != 0) revert Adapter_FeeTooLow(minGas, amount);
        if (minGas > 0) {
            if (protocolFeeRecipient == address(0)) revert Adapter_FeeTransferFailed();
            // Transfer fee to protocol
            (bool success, ) = protocolFeeRecipient.call{value: minGas}("");
            if (!success) revert Adapter_FeeTransferFailed();
        }
        return amount - minGas;
    }

    /// @notice Sets domain IDs and corresponding chain IDs.
    /// @dev Only the owner can call this function.
    /// @param chainIds Array of chain IDs.
    /// @param enabled Boolean array to enable or disable the chain IDs.
    function setDomainId(uint256[] memory chainIds, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < chainIds.length; i++) {
            supportedChainIds[chainIds[i]] = enabled;
            emit ChainIdSet(chainIds[i], enabled);
        }
    }
}
