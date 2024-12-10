// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {AggregatorV3Interface} from "../interfaces/IOracleAggregatorV2V3.sol";
import "hardhat/console.sol";

contract SequencerUptimeFeedMock is AggregatorV3Interface {
    uint256 public startedAt;
    int256 public answer;

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, startedAt, 0, 0);
    }

    // setters
    function setStartedAt(uint256 _startedAt) external {
        startedAt = _startedAt;
    }

    function setAnswer(int256 _answer) external {
        answer = _answer;
    }

    // Not implemented

    function decimals() external view returns (uint8) {}

    function description() external view returns (string memory) {}

    function version() external view returns (uint256) {}

    function getRoundData(
        uint80 _roundId
    ) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) {}
}
