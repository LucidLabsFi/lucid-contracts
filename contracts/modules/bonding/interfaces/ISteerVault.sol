// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

interface ISteerVault {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function getTotalAmounts() external view returns (uint256, uint256);

    function totalSupply() external view returns (uint256);

    function decimals() external view returns (uint8);

    function TOTAL_FEE() external view returns (uint256);

    function getPositions() external view returns (int24[] memory lowerTick, int24[] memory upperTick, uint16[] memory relativeWeight);
}
