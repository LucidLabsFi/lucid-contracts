// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BaseStrategy} from "./BaseStrategy.sol";

/// @title QuadraticVoteStrategy
/// @notice Quadratic with Threshold strategy. Vote weight below a threshold is linear, above it is quadratic
contract QuadraticVoteStrategy is BaseStrategy {
    /// @notice The threshold for the quadratic voting. It should be represented with the same number of decimals as the token
    uint256 public quadraticThreshold;
    /// @notice The decimals of the threshold, should be the same as the token
    uint256 public thresholdDecimals;

    /// @notice Constructor to initialize the QuadraticVoteStrategy
    /// @param tokenAddress Address of the token
    /// @param _threshold The threshold for the quadratic voting
    /// @param _decimals The decimals of the threshold, should be the same as the token
    constructor(
        address tokenAddress,
        address governorAddress,
        uint256 _threshold,
        uint256 _decimals
    ) BaseStrategy(tokenAddress, governorAddress, "Quadratic with Threshold") {
        quadraticThreshold = _threshold;
        thresholdDecimals = _decimals;
    }

    /// @notice Gets the votes for a given account and timepoint
    /// @param account Address of the account
    /// @param timepoint Timepoint for the votes
    /// @return The votes for the account
    function getVotes(address account, uint256 timepoint, bytes memory /*params*/) external view override returns (uint256) {
        return _applyStrategy(account, token.getPastVotes(account, timepoint));
    }

    /// @notice Applies the core voting strategy for a given account and weight
    /// @param account Address of the account
    /// @param weight Weight of the account
    /// @return The votes for the account
    function _applyStrategy(address account, uint256 weight) internal view override returns (uint256) {
        // If weight is less or equal to the threshold, return the weight, otherwise return the square root of the weight plus the threshold
        if (weight <= quadraticThreshold) {
            // below threshold voting power is linear
            return weight;
        } else {
            uint256 weightSqrt = Math.sqrt((weight - quadraticThreshold) / 10 ** thresholdDecimals);
            return weightSqrt * 10 ** thresholdDecimals + quadraticThreshold;
        }
    }

    function quorum(uint256 timepoint) public view override returns (uint256) {
        uint256 totalSupplyEth = IERC20Metadata(address(token)).totalSupply() / (10 ** IERC20Metadata(address(token)).decimals());
        return
            ((Math.sqrt(totalSupplyEth) * (10 ** IERC20Metadata(address(token)).decimals())) * governor.quorumNumerator(timepoint)) /
            governor.quorumDenominator();
    }
}
