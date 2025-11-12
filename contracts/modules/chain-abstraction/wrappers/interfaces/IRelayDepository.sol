// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title IRelayDepository
/// @notice Interface for the RelayDepository contract
interface IRelayDepository {
    /// @notice Set of executed call requests
    function callRequests(bytes32) external view returns (bool);

    /// @notice Deposit native tokens and emit a `RelayNativeDeposit` event
    /// @param depositor The address of the depositor - set to `address(0)` to credit `msg.sender`
    /// @param id The id associated with the deposit
    function depositNative(address depositor, bytes32 id) external payable;

    /// @notice Deposit erc20 tokens and emit an `RelayErc20Deposit` event
    /// @param depositor The address of the depositor - set to `address(0)` to credit `msg.sender`
    /// @param token The erc20 token to deposit
    /// @param amount The amount to deposit
    /// @param id The id associated with the deposit
    function depositErc20(address depositor, address token, uint256 amount, bytes32 id) external;
}
