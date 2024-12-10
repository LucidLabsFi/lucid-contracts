// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IGovernor {
    function castCrossChainVote(
        uint256 chainId,
        address voter,
        uint256 voteWeight,
        address sourceToken,
        uint256 timepoint,
        uint256 proposalId,
        uint8 support,
        bytes memory voteData
    ) external;
}
