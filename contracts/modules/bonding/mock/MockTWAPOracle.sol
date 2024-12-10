// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

contract MockTWAPOracle is ITWAPOracle {
    mapping(address => mapping(address => uint256)) private _prices;

    constructor() {}

    function setPrice(address _token, address _relativeTo, uint256 _price) public {
        _prices[_token][_relativeTo] = _price;
    }

    function getPrice(address token, address relativeTo) external view returns (uint256) {
        return _prices[token][relativeTo];
    }
}
