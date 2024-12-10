// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGovernorVotesQuorumFraction} from "./interfaces/IGovernorVotesQuorumFraction.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

/// @title BaseStrategy
/// @notice Base contract holding the common logic for all strategies
abstract contract BaseStrategy is IStrategy {
    /// @notice Address of the token
    IVotes public immutable token;
    /// @notice Address of the governor
    IGovernorVotesQuorumFraction public immutable governor;
    /// @notice Name of the strategy
    string public strategyName;

    /// @notice Constructor to initialize the BaseStrategy
    /// @param tokenAddress Address of the token
    /// @param name Name of the strategy
    constructor(address tokenAddress, address governorAddress, string memory name) {
        token = IVotes(tokenAddress);
        governor = IGovernorVotesQuorumFraction(governorAddress);
        strategyName = name;
    }

    /// @notice Gets the votes for a given account and timepoint
    /// @dev Complies with the IVotes interface
    function getVotes(address account, uint256 timepoint, bytes memory /*params*/) external view virtual returns (uint256);

    /// @notice Applies the strategy for a given account and weight
    /// @param account Address of the account
    /// @param weight Weight of the account
    /// @return The votes for the account
    function _applyStrategy(address account, uint256 weight) internal view virtual returns (uint256);

    /// @notice Gets the votes for a given account and weight
    /// @param account Address of the account
    /// @param weight Weight of the account
    /// @return The votes for the account
    function getVotesForWeight(address account, uint256 weight) external view returns (uint256) {
        return _applyStrategy(account, weight);
    }

    function quorum(uint256 timepoint) public view virtual returns (uint256) {
        return (token.getPastTotalSupply(timepoint) * governor.quorumNumerator(timepoint)) / governor.quorumDenominator();
    }
}
