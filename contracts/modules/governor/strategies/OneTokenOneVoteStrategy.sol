// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {BaseStrategy} from "./BaseStrategy.sol";

/// @title OneTokenOneVoteStrategy
/// @notice One token - One vote contract that returns the number of votes based on the number of tokens held
contract OneTokenOneVoteStrategy is BaseStrategy {
    /// @notice Constructor to initialize the OneTokenOneVoteStrategy
    /// @param tokenAddress Address of the token
    constructor(address tokenAddress, address governorAddress) BaseStrategy(tokenAddress, governorAddress, "One Token One Vote") {}

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
        return weight;
    }
}
