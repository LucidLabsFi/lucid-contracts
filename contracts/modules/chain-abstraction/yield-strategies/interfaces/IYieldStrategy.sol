// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

/**
 * @title IYieldStrategy
 * @notice Interface for yield-generating strategies that can be plugged into a LockReleaseAssetController
 */
interface IYieldStrategy {
    /**
     * @notice Deposits funds into the yield strategy
     * @param amount The amount of underlying tokens to deposit
     */
    function deposit(uint256 amount) external;

    /**
     * @notice Withdraws principal (deposited amount) from the strategy
     * @param amount The amount of principal to withdraw
     * @return The amount actually withdrawn
     */
    function withdraw(uint256 amount) external returns (uint256);

    /**
     * @notice Withdraws only the currently accumulated yield to a specified recipient
     * @param recipient The address to receive the yield
     * @return The amount of yield withdrawn
     */
    function withdrawYield(address recipient) external returns (uint256);

    /**
     * @notice Returns the total principal deposited (excluding yield)
     * @return The principal amount
     */
    function getPrincipal() external view returns (uint256);

    /**
     * @notice Returns the total balance including principal and yield
     * @return The total balance
     */
    function getTotalBalance() external view returns (uint256);

    /**
     * @notice Returns the currently accumulated yield
     * @return The yield amount
     */
    function getYield() external view returns (uint256);

    /**
     * @notice Returns the underlying asset address
     * @return The asset address
     */
    function asset() external view returns (address);
}
