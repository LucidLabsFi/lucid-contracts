// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.19 <=0.8.20;

interface IBaseAdapter {
    /// @notice Struct used by the adapter to relay messages
    struct BridgedMessage {
        bytes message;
        address originController;
        address destController;
    }

    /// @param chainId The chain ID to check.
    /// @return bool True if the chain ID is supported, false otherwise.
    function isChainIdSupported(uint256 chainId) external view returns (bool);

    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param refundAddress The address to refund any unused gas fees.
    /// @param message The message data to be relayed.
    /// @return transferId The transfer ID of the relayed message.
    function relayMessage(
        uint256 destChainId,
        address destination,
        address refundAddress,
        bytes memory message
    ) external payable returns (bytes32 transferId);
}
