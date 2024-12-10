// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {TimestampCheckpoints} from "./libraries/TimestampCheckpoints.sol";
import {IFractionalGovernor} from "./interfaces/IFractionalGovernor.sol";
import {IVotingToken} from "./interfaces/IVotingToken.sol";

/// @notice This is an abstract contract designed to make it easy to build clients
/// for governance systems that inherit from GovernorCountingFractional, a.k.a.
/// Flexible Voting governors.
///
/// A "client" in this sense is a contract that:

/// - (a) receives deposits of governance tokens from its users,
/// - (b) gives said depositors the ability to express their voting preferences
///   on governance proposals, and
/// - (c) casts votes on said proposals to flexible voting governors according
///   to the expressed preferences of its depositors.
///
/// This contract assumes that a child contract will implement a mechanism for
/// receiving and storing deposit balances, part (a). With that in place, this
/// contract supplies features (b) and (c).
///
/// A key concept here is that of a user's "raw balance". The raw balance is the
/// system's internal representation of a user's claim on the governance tokens
/// that it custodies. Since different systems might represent such claims in
/// different ways, this contract leaves the implementation of the `_rawBalance`
/// function to the child contract.
///
/// The simplest such representation would be to directly store the cumulative
/// balance of the governance token that the user has deposited. In such a
/// system, the amount that the user deposits is the amount that the user has
/// claim to. If the user has claim to 1e18 governance tokens, the internal
/// representation is just 1e18.
///
/// In many systems, however, the raw balance will not be equivalent to the
/// amount of governance tokens the user has claim to. In Aave, for example,
/// deposit amounts are scaled down by an ever-increasing index that represents
/// the cumulative amount of interest earned over the lifetime of deposits. The
/// "raw balance" of a user in Aave's case is this scaled down amount, since it
/// is the value that represents the user's claim on deposits. Thus for Aave, a
/// users's raw balance will always be less than the actual amount they have
/// claim to.
///
/// If the raw balance can be identified and defined for a system, and
/// `_rawBalance` can be implemented for it, then this contract will take care
/// of the rest.
///
/// This contract is not compatible with quadratic voting strategies. It should
/// not be used with tokens that are governance tokens of governors using a quadratic
/// voting strategy. This is enforced on the FE side.
/// @dev Modified to support multiple governors that use timestamp voting
abstract contract FlexVotingClient {
    using SafeCast for uint256;
    using TimestampCheckpoints for TimestampCheckpoints.History;

    error FlexVoting_NotGovernanceToken();
    error FlexVoting_AlreadyVoted();
    error FlexVoting_NoWeight();
    error FlexVoting_NoVotesExpressed();

    /// @notice The voting options corresponding to those used in the Governor.
    enum VoteType {
        Against,
        For,
        Abstain
    }

    /// @notice Data structure to store vote preferences expressed by depositors.
    struct ProposalVote {
        uint128 againstVotes;
        uint128 forVotes;
        uint128 abstainVotes;
    }

    /// @dev Map hash of (governor address to proposalId to an address) to whether they have voted on this proposal.
    mapping(bytes32 => bool) private proposalVotersHasVoted;

    /// @notice Map governor address to proposalId to vote totals expressed on this proposal.
    mapping(address => mapping(uint256 => ProposalVote)) public proposalVotes;

    /// @notice The governor contract associated with this governance token. It
    /// must be one that supports fractional voting, e.g. GovernorCountingFractional.
    IVotingToken public immutable VOTINGTOKEN;

    /// @dev Mapping from address to the checkpoint history of raw balances
    /// of that address.
    mapping(address => TimestampCheckpoints.History) private balanceCheckpoints;

    /// @dev History of the sum total of raw balances in the system. May or may
    /// not be equivalent to this contract's balance of `GOVERNOR`s token at a
    /// given time.
    TimestampCheckpoints.History internal totalBalanceCheckpoints;

    /// @param _votingToken The address of the token
    constructor(address _votingToken) {
        VOTINGTOKEN = IVotingToken(_votingToken);
        _selfDelegate();
    }

    /// @dev Returns a representation of the current amount of `GOVERNOR`s
    /// token that `_user` has claim to in this system. It may or may not be
    /// equivalent to the withdrawable balance of `GOVERNOR`s token for `user`,
    /// e.g. if the internal representation of balance has been scaled down.
    /// @dev Needs to be implemented by the child contract.
    function _rawBalanceOf(address _user) internal view virtual returns (uint256);

    /// @dev Used as the `reason` param when submitting a vote to `GOVERNOR`.
    function _castVoteReasonString() internal virtual returns (string memory) {
        return "rolled-up vote from governance token holders";
    }

    /// @dev Delegates the present contract's voting rights with `GOVERNOR` to itself.
    function _selfDelegate() public {
        VOTINGTOKEN.delegate(address(this));
    }

    /// @notice Allow the caller to express their voting preference for a given
    /// proposal. Their preference is recorded internally but not moved to the
    /// Governor until `castVote` is called.
    /// @param proposalId The proposalId in the associated Governor
    /// @param support The depositor's vote preferences in accordance with the `VoteType` enum.
    function expressVote(address governor, uint256 proposalId, uint8 support) external {
        IFractionalGovernor GOVERNOR = IFractionalGovernor(governor);
        if (GOVERNOR.token() != address(VOTINGTOKEN)) revert FlexVoting_NotGovernanceToken();

        uint256 weight = getPastRawBalance(msg.sender, GOVERNOR.proposalSnapshot(proposalId));
        if (weight == 0) revert FlexVoting_NoWeight();

        bytes32 _key = _getVoterKey(governor, proposalId, msg.sender);
        if (proposalVotersHasVoted[_key]) revert FlexVoting_AlreadyVoted();
        proposalVotersHasVoted[_key] = true;

        if (support == uint8(VoteType.Against)) {
            proposalVotes[governor][proposalId].againstVotes += SafeCast.toUint128(weight);
        } else if (support == uint8(VoteType.For)) {
            proposalVotes[governor][proposalId].forVotes += SafeCast.toUint128(weight);
        } else if (support == uint8(VoteType.Abstain)) {
            proposalVotes[governor][proposalId].abstainVotes += SafeCast.toUint128(weight);
        } else {
            revert("invalid support value, must be included in VoteType enum");
        }
    }

    /// @notice Causes this contract to cast a vote to the Governor for all of the
    /// accumulated votes expressed by users. Uses the sum of all raw balances to
    /// proportionally split its voting weight. Can be called by anyone. Can be
    /// called multiple times during the lifecycle of a given proposal.
    /// @param proposalId The ID of the proposal which the Pool will now vote on.
    function castVote(address governor, uint256 proposalId) external {
        IFractionalGovernor GOVERNOR = IFractionalGovernor(governor);
        if (GOVERNOR.token() != address(VOTINGTOKEN)) revert FlexVoting_NotGovernanceToken();

        ProposalVote storage _proposalVote = proposalVotes[governor][proposalId];
        if (_proposalVote.forVotes + _proposalVote.againstVotes + _proposalVote.abstainVotes == 0) revert FlexVoting_NoVotesExpressed();
        uint256 _proposalSnapshotBlockNumber = GOVERNOR.proposalSnapshot(proposalId);

        // We use the snapshot of total raw balances to determine the weight with
        // which to vote. We do this for two reasons:
        //   (1) We cannot use the proposalVote numbers alone, since some people with
        //       balances at the snapshot might never express their preferences. If a
        //       large holder never expressed a preference, but this contract nevertheless
        //       cast votes to the governor with all of its weight, then other users may
        //       effectively have *increased* their voting weight because someone else
        //       didn't participate, which creates all kinds of bad incentives.
        //   (2) Other people might have already expressed their preferences on this
        //       proposal and had those preferences submitted to the governor by an
        //       earlier call to this function. The weight of those preferences
        //       should still be taken into consideration when determining how much
        //       weight to vote with this time.
        // Using the total raw balance to proportion votes in this way means that in
        // many circumstances this function will not cast votes with all of its
        // weight.
        uint256 _totalRawBalanceAtSnapshot = getPastTotalBalance(_proposalSnapshotBlockNumber);

        // We need 256 bits because of the multiplication we're about to do.
        uint256 _votingWeightAtSnapshot = VOTINGTOKEN.getPastVotes(address(this), _proposalSnapshotBlockNumber);

        //      forVotesRaw          forVoteWeight
        // --------------------- = ------------------
        //     totalRawBalance      totalVoteWeight
        //
        // forVoteWeight = forVotesRaw * totalVoteWeight / totalRawBalance
        uint128 _forVotesToCast = SafeCast.toUint128((_votingWeightAtSnapshot * _proposalVote.forVotes) / _totalRawBalanceAtSnapshot);
        uint128 _againstVotesToCast = SafeCast.toUint128((_votingWeightAtSnapshot * _proposalVote.againstVotes) / _totalRawBalanceAtSnapshot);
        uint128 _abstainVotesToCast = SafeCast.toUint128((_votingWeightAtSnapshot * _proposalVote.abstainVotes) / _totalRawBalanceAtSnapshot);

        // This param is ignored by the governor when voting with fractional
        // weights. It makes no difference what vote type this is.
        uint8 unusedSupportParam = uint8(VoteType.Abstain);

        // Clear the stored votes so that we don't double-cast them.
        delete proposalVotes[governor][proposalId];

        bytes memory fractionalizedVotes = abi.encodePacked(_againstVotesToCast, _forVotesToCast, _abstainVotesToCast);
        GOVERNOR.castVoteWithReasonAndParams(proposalId, unusedSupportParam, _castVoteReasonString(), fractionalizedVotes);
    }

    /// @dev Checkpoints the _user's current raw balance.
    /// @dev Needs to be called by the child contract whenever the user's raw balance changes.
    function _checkpointRawBalanceOf(address _user) internal {
        balanceCheckpoints[_user].push(_rawBalanceOf(_user));
    }

    /// @dev Checkpoints the total current raw balance.
    /// @dev Needs to be called by the child contract whenever the total raw balance changes.
    function _checkpointTotalRawBalance(uint256 _amount) internal {
        totalBalanceCheckpoints.push(_amount);
    }

    /// @notice Returns the `_user`'s raw balance at `_timestamp`.
    /// @param _user The account that's historical raw balance will be looked up.
    /// @param _timestamp The timestamp at which to lookup the _user's raw balance.
    function getPastRawBalance(address _user, uint256 _timestamp) public view returns (uint256) {
        return balanceCheckpoints[_user].getAtProbablyRecentTimestamp(_timestamp);
    }

    /// @notice Returns the sum total of raw balances of all users at `_blockNumber`.
    /// @param _timestamp The timestamp at which to lookup the total balance.
    function getPastTotalBalance(uint256 _timestamp) public view returns (uint256) {
        return totalBalanceCheckpoints.getAtProbablyRecentTimestamp(_timestamp);
    }

    function _getVoterKey(address governor, uint256 proposalId, address voter) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(governor, proposalId, voter));
    }

    /**
     * @notice Fallback function to receive ether
     */
    receive() external payable {}
}
