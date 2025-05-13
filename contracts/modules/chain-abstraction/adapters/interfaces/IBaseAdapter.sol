// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.19 <=0.8.20;

interface IBaseAdapter {
    /// @notice Struct used by the adapter to relay messages
    struct BridgedMessage {
        bytes message;
        address originController;
        address destController;
    }

    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param options Additional options to be used by the adapter.
    /// @param message The message data to be relayed.
    /// @return transferId The transfer ID of the relayed message.
    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes calldata message
    ) external payable returns (bytes32 transferId);

    /// @param chainId The chain ID to check.
    /// @return bool True if the chain ID is supported, false otherwise.
    function isChainIdSupported(uint256 chainId) external view returns (bool);
}
