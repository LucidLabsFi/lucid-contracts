// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

interface IVotingController {
    struct SigVoteParams {
        uint256 proposalId;
        uint8 support;
        bytes signature;
        bytes voteData; // optional value
    }

    struct RelayedMessage {
        address governor;
        address sourceToken;
        address voter;
        uint256 timepoint;
        uint256 voteWeight;
        uint256 proposalId;
        uint8 support;
        bytes voteData; // optional value
    }

    struct RelayParams {
        address adapter;
        bytes options;
        uint256 chainId;
        address sourceToken;
        address destGovernor;
        uint256 timepoint;
        SigVoteParams sigVoteParams;
    }

    // Timepoint is the timestamp of the proposal creation timestamp in the main chain. This must be the same in order for the vote to be accepted.
    // Clock must be in timestamp format
    function relayVote(RelayParams calldata _calldata) external payable;
}
