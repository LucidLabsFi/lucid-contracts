// SPDX-License-Identifier: GPL
pragma solidity 0.8.19;

interface IGitcoinPassportDecoder {
    function getScore(address user) external view returns (uint256);
}
