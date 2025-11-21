// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AavePoolMock
 * @notice Unified mock contract - the pool itself is the aToken (ERC20)
 */
contract AavePoolMock is ERC20 {
    using SafeERC20 for IERC20;

    address public admin;
    address public underlyingAsset;
    bool public forcePartialWithdrawal;

    event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode);

    event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount);

    /**
     * @param _admin Admin address for yield simulation
     * @param _underlyingAsset The underlying asset this pool accepts
     * @param _name ERC20 name for the aToken (e.g., "Aave USDC")
     * @param _symbol ERC20 symbol for the aToken (e.g., "aUSDC")
     */
    constructor(address _admin, address _underlyingAsset, string memory _name, string memory _symbol) ERC20(_name, _symbol) {
        admin = _admin;
        underlyingAsset = _underlyingAsset;
    }

    /**
     * @notice Supply assets to the pool and receive aTokens (this contract's tokens)
     * @dev Matches Aave Pool supply interface
     * @param asset The address of the underlying asset being supplied
     * @param amount The amount of asset to be supplied
     * @param onBehalfOf The address that will receive the aTokens
     * @param referralCode Referral code (not used in mock)
     */
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        require(asset == underlyingAsset, "Wrong asset");

        // Transfer underlying asset from user to pool
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        // Mint aTokens (this ERC20) to onBehalfOf
        _mint(onBehalfOf, amount);

        emit Supply(asset, msg.sender, onBehalfOf, amount, referralCode);
    }

    /**
     * @notice Withdraw assets from the pool by burning aTokens
     * @dev Matches Aave Pool withdraw interface
     * @param asset The address of the underlying asset to withdraw
     * @param amount The amount to withdraw (use type(uint256).max to withdraw all)
     * @param to The address that will receive the underlying asset
     * @return The actual amount withdrawn
     */
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(asset == underlyingAsset, "Wrong asset");

        uint256 userBalance = balanceOf(msg.sender);
        uint256 poolBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountToWithdraw = amount == type(uint256).max ? userBalance : amount;

        require(amountToWithdraw <= userBalance, "Insufficient aToken balance");

        // If pool doesn't have enough underlying, limit to what's available
        if (amountToWithdraw > poolBalance) {
            amountToWithdraw = poolBalance;
        }

        // Force partial withdrawal for testing (return 50% of requested amount)
        if (forcePartialWithdrawal && amount != type(uint256).max) {
            amountToWithdraw = amountToWithdraw / 2;
        }

        // Burn aTokens (this ERC20) from user
        _burn(msg.sender, amountToWithdraw);

        // Transfer underlying asset to recipient
        IERC20(asset).safeTransfer(to, amountToWithdraw);

        emit Withdraw(asset, msg.sender, to, amountToWithdraw);

        return amountToWithdraw;
    }

    /**
     * @notice Admin function to simulate yield by minting additional aTokens
     * @dev Called by admin to mimic interest accrual on aTokens
     * @param user The user whose balance will increase
     * @param yieldAmount The amount of yield to credit
     */
    function simulateYield(address user, uint256 yieldAmount) external {
        require(msg.sender == admin, "Only admin can simulate yield");

        // Mint additional aTokens (this ERC20) to simulate yield
        _mint(user, yieldAmount);
    }

    /**
     * @notice Admin function to change the underlying asset address
     * @dev For testing purposes only
     * @param _underlyingAsset The new underlying asset address
     */
    function setUnderlyingAsset(address _underlyingAsset) external {
        underlyingAsset = _underlyingAsset;
    }

    /**
     * @notice Admin function to force partial withdrawals for testing
     * @dev When enabled, withdrawals will only return 50% of requested amount
     * @param _forcePartial Whether to force partial withdrawals
     */
    function setForcePartialWithdrawal(bool _forcePartial) external {
        require(msg.sender == admin, "Only admin can set force partial withdrawal");
        forcePartialWithdrawal = _forcePartial;
    }

    /**
     * @notice Returns the aToken address for a given asset
     * @dev In this mock, the pool itself is the aToken
     * @param asset The underlying asset address
     * @return The aToken address (this contract)
     */
    function getReserveAToken(address asset) external view returns (address) {
        if (asset == underlyingAsset) {
            return address(this);
        } else {
            return address(0);
        }
    }
}
