// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IRefundGas {
    function updateGovernor(address _governor) external;

    function transferOwnership(address newOwner) external;

    function governor() external view returns (address);
}
