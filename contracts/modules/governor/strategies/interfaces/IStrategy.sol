// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

interface IStrategy {
    function quorum(uint256 timepoint) external view returns (uint256);

    function getVotes(address account, uint256 timepoint, bytes memory /*params*/) external view returns (uint256);

    function getVotesForWeight(address account, uint256 weight) external view returns (uint256);
}
