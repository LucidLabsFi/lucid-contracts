// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.19;

import {ISteerVault} from "../interfaces/ISteerVault.sol";
import {SimpleToken, IERC20} from "../../../tokens/mock/SimpleERC20.sol";

contract MockSteerPool is SimpleToken {
    address public token0address;
    address public token1address;
    uint256 public totalAmount0;
    uint256 public totalAmount1;

    // We consider that the LP token has 18 decimals

    constructor() SimpleToken() {}

    // Setters

    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    function setToken0(address token_) public {
        token0address = token_;
    }

    function setToken1(address token_) public {
        token1address = token_;
    }

    function setToken0Amount(uint256 amount_) public {
        totalAmount0 = amount_;
    }

    function setToken1Amount(uint256 amount_) public {
        totalAmount1 = amount_;
    }

    // Standard functions

    function token0() external view returns (address) {
        return token0address;
    }

    function token1() external view returns (address) {
        return token1address;
    }

    function getTotalAmounts() external view returns (uint256, uint256) {
        return (totalAmount0, totalAmount1);
    }

    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256, uint256, address to) external returns (uint256, uint256, uint256) {
        IERC20(token0address).transferFrom(msg.sender, address(this), amount0Desired);
        IERC20(token1address).transferFrom(msg.sender, address(this), amount1Desired);
        _mint(to, 100 * 10 ** 18);
        return (amount0Desired, amount1Desired, 100 * 10 ** 18);
    }
}
