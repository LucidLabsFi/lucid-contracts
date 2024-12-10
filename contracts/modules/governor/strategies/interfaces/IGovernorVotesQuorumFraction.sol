// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IGovernorVotesQuorumFraction {
    function quorum(uint256 timepoint) external view returns (uint256);

    function quorumNumerator(uint256 timepoint) external view returns (uint256);

    function quorumDenominator() external view returns (uint256);
}
