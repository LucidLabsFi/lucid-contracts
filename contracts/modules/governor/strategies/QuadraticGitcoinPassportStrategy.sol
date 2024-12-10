// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IGitcoinPassportDecoder} from "./interfaces/IGitcoinPassportDecoder.sol";
import {BaseStrategy} from "./BaseStrategy.sol";

/// @title QuadraticGitcoinPassportStrategy
/// @notice Quadratic with Threshold and Gitcoin Passport strategy that returns the quadratic votes after the threshold applying a bonus on the voting power
contract QuadraticGitcoinPassportStrategy is BaseStrategy {
    // threshold should be represented with the same number of decimals as the token

    error Strategy_InvalidScores();

    /// @notice The threshold for the quadratic voting. Vote weight below this threshold is linear, above it is quadratic
    uint256 public quadraticThreshold;
    /// @notice The decimals of the threshold, should be the same as the token
    uint256 public thresholdDecimals;

    /// @notice Address of the Gitcoin Passport Decoder
    address public passportDecoder;
    /// @notice The score ranges for the bonus calculation
    uint256[4] public scoreRanges;
    /// @notice The score amplifiers for the bonus calculation
    uint256[2] public scoreAmplifiers;

    /// @notice Constructor to initialize the QuadraticGitcoinPassportStrategy
    /// @param tokenAddress Address of the token
    /// @param _threshold The threshold for the quadratic voting
    /// @param _decimals The decimals of the threshold, should be the same as the token
    /// @param _passport The address of the Gitcoin Passport Decoder
    /// @param _scoreRanges The score ranges for the bonus calculation (2 decimals, eg. 15 -> 1500)
    /// @param _scoreAmplifiers The score amplifiers for the bonus calculation (4 decimals, eg. 15 -> 150000)
    constructor(
        address tokenAddress,
        address governorAddress,
        uint256 _threshold,
        uint256 _decimals,
        address _passport,
        uint256[4] memory _scoreRanges,
        uint256[2] memory _scoreAmplifiers
    ) BaseStrategy(tokenAddress, governorAddress, "Quadratic with Threshold and Gitcoin Passport") {
        if (_scoreAmplifiers[0] > _scoreAmplifiers[1]) revert Strategy_InvalidScores();
        if ((_scoreRanges[0] > _scoreRanges[1]) || (_scoreRanges[1] > _scoreRanges[2]) || (_scoreRanges[2] > _scoreRanges[3]))
            revert Strategy_InvalidScores();
        quadraticThreshold = _threshold;
        thresholdDecimals = _decimals;
        passportDecoder = _passport;
        scoreRanges = _scoreRanges;
        scoreAmplifiers = _scoreAmplifiers;
    }

    /// @notice Gets the votes for a given account and timepoint
    /// @param account Address of the account
    /// @param timepoint Timepoint for the votes
    /// @return The votes for the account
    function getVotes(address account, uint256 timepoint, bytes memory /*params*/) external view override returns (uint256) {
        return _applyStrategy(account, token.getPastVotes(account, timepoint));
    }

    /// @notice Applies the core voting strategy for a given account and weight. Applies a bonus based on the account's Gitcoin Passport score
    /// @param account Address of the account
    /// @param weight Weight of the account
    /// @return The votes for the account
    function _applyStrategy(address account, uint256 weight) internal view override returns (uint256) {
        // If weight is less or equal to the threshold, return the weight, otherwise return the square root of the weight plus the threshold
        uint256 quadraticWeight;
        if (weight <= quadraticThreshold) {
            // below threshold voting power is linear
            quadraticWeight = weight;
        } else {
            uint256 weightSqrt = Math.sqrt((weight - quadraticThreshold) / 10 ** thresholdDecimals);
            quadraticWeight = weightSqrt * 10 ** thresholdDecimals + quadraticThreshold;
        }

        return _applyScore(account, quadraticWeight);
    }

    /// @notice Applies the bonus based on the account's Gitcoin Passport score
    /// @param account Address of the account
    /// @param votes Votes to apply the bonus to
    /// @return total The total votes after applying the bonus
    function _applyScore(address account, uint256 votes) internal view returns (uint256 total) {
        uint256 score = _getPassportScore(account);
        if (score < scoreAmplifiers[0]) {
            // Base match rate for scores less than scoreAmplifiers[0]
            total = votes + (votes * scoreRanges[0]) / 100;
        } else if (score == scoreAmplifiers[0]) {
            // Base match rate for a score of scoreAmplifiers[0]
            total = votes + (votes * scoreRanges[1]) / 100;
        } else if (score < scoreAmplifiers[1]) {
            // Proportional match between user-defined scoreRanges[1] and scoreRanges[2] for scores between scoreAmplifiers[0] and scoreAmplifiers[1]
            uint256 matchRate = scoreRanges[1] +
                ((score - scoreAmplifiers[0]) * (scoreRanges[2] - scoreRanges[1])) /
                (scoreAmplifiers[1] - scoreAmplifiers[0]);
            total = votes + (votes * matchRate) / 100;
        } else {
            // User-defined scoreRanges[3] for scores greater than scoreAmplifiers[1]
            total = votes + (votes * scoreRanges[3]) / 100;
        }
        return total;
    }

    /// @notice Gets the Gitcoin Passport score from Gitcoin Passport Decoder for the given account
    /// @param account Address of the account
    /// @return The Gitcoin Passport score
    function _getPassportScore(address account) internal view returns (uint256) {
        bytes memory data = abi.encodeWithSelector(IGitcoinPassportDecoder.getScore.selector, account);
        (bool success, bytes memory returnData) = passportDecoder.staticcall(data);
        if (success) {
            // Gitcoin Passport Scores have 4 decimals
            return abi.decode(returnData, (uint256));
        } else {
            return 0;
        }
    }

    function quorum(uint256 timepoint) public view override returns (uint256) {
        uint256 totalSupplyEth = IERC20Metadata(address(token)).totalSupply() / (10 ** IERC20Metadata(address(token)).decimals());
        return
            ((Math.sqrt(totalSupplyEth) * (10 ** IERC20Metadata(address(token)).decimals())) * governor.quorumNumerator(timepoint)) /
            governor.quorumDenominator();
    }
}
