// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Predeploys} from "./optimism/Predeploys.sol";
import {IL2ToL2CrossDomainMessenger} from "./interfaces/IL2ToL2CrossDomainMessenger.sol";
import {BaseAdapter, IController} from "../BaseAdapter.sol";

/// @title OptimismL2 Adapter
/// @notice Adapter contract that integrates with Optimism's IL2ToL2CrossDomainMessenger to send and receive messages between L2s.
contract OptimismL2Adapter is BaseAdapter {
    /// @notice Event emitted when a chain ID has been set
    event ChainIdSet(uint256 chainId, bool enabled);

    /// @notice Error messages when quoted fee after deductions is too low
    error Adapter_FeeTooLow(uint256 requiredFee, uint256 deductedFee);

    /// @dev The L2 to L2 cross domain messenger predeploy to handle message passing
    IL2ToL2CrossDomainMessenger public messenger = IL2ToL2CrossDomainMessenger(Predeploys.L2_TO_L2_CROSS_DOMAIN_MESSENGER);

    /// @notice Maps accesible Optimism's chains IDs.
    mapping(uint256 => bool) public supportedChainIds;

    /// @notice Constructor to initialize the OptimismL2Adapter.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message. Acts as a fixed protocol fee.
    /// @param treasury Address of the treasury.
    /// @param chainIds Array of chain IDs supported by the adapter.
    constructor(
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint256[] memory chainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, 0, owner) {
        for (uint256 i = 0; i < chainIds.length; i++) {
            supportedChainIds[chainIds[i]] = true;
            emit ChainIdSet(chainIds[i], true);
        }
    }

    /// @notice Sends a message to L2ToL2CrossDomainMessenger.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Refunds back to refundAddress any unused gas fees. Returned value is always 0 since no id is produced, should be ignored.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param options Additional params to be used by the adapter, abi encoded refund address.
    /// @param message The message data to be relayed.
    /// @return transferId Bytes32(0), CrossL2Inbox doesn't return a transferId.
    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes memory message
    ) external payable virtual override whenNotPaused returns (bytes32) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        address destAdapter = trustedAdapters[destChainId];
        if (!supportedChainIds[destChainId] || destAdapter == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        bytes memory relayedMessage = abi.encode(BridgedMessage(message, msg.sender, destination));
        _collectAndRefundFees(abi.decode(options, (address)));

        messenger.sendMessage(destChainId, destAdapter, abi.encodeCall(this.receiveMessage, (relayedMessage)));
    }

    /// @notice Receives a message.
    /// @param _callData The calldata of the message.
    function receiveMessage(bytes calldata _callData) external payable virtual whenNotPaused {
        uint256 originChainId = messenger.crossDomainMessageSource();
        if ((msg.sender != address(messenger)) || (messenger.crossDomainMessageSender() != trustedAdapters[originChainId]))
            revert Adapter_Unauthorised();

        _registerMessage(_callData, originChainId);
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

    /// @notice Registers a received message and processes it
    /// @dev Overwritter function that doesn't use a transfer id or originSender. Removes functionality to check for duplicate messages.
    /// @param message The message data.
    /// @param originChain The origin chain ID.
    function _registerMessage(bytes memory message, uint256 originChain) internal {
        // Decode message and get the controller
        BridgedMessage memory bridgedMsg = abi.decode(message, (BridgedMessage));
        IController(bridgedMsg.destController).receiveMessage(bridgedMsg.message, originChain, bridgedMsg.originController);
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
