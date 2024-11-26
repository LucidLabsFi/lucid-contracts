// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IFeeCollector {
    function collect(address token, uint256 amount) external;

    function quote(uint256 amount) external view returns (uint256 fee);
}
