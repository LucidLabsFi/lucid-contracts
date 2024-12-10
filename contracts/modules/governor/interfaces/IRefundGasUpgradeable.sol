// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IRefundGasUpgradeable {
    function refundGas(address payable voter, uint256 startGas) external;
}
