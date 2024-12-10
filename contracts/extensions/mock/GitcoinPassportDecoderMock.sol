// SPDX-License-Identifier: GPL
pragma solidity 0.8.19;

contract GitcoinPassportDecoderMock {
    /**
     * @dev A struct representing the passport score for an ETH address.
     */
    struct Score {
        uint256 score;
    }

    mapping(address => Score) internal _scores; // storred with 4 decimals (eg. 15 -> 150000)

    constructor() {}

    function getScore(address userAddress) external view returns (uint256) {
        return _scores[userAddress].score;
    }

    function setScore(address userAddress, uint256 score) external {
        _scores[userAddress] = Score(score);
    }
}
