// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

interface ITWAPOracle {
    struct TWAP {
        uint256 price;
        uint64 timestamp;
    }

    function getPrice(address, address) external view returns (uint256);
}
