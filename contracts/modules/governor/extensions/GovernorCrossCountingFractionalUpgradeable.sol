// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ECDSAUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {GovernorCompatibilityBravoUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/compatibility/GovernorCompatibilityBravoUpgradeable.sol";
import {SafeCastUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// forked from https://github.com/ScopeLift/flexible-voting/blob/e5de2efd1368387b840931f19f3c184c85842761/src/GovernorCountingFractional.sol

/**
 * @notice Extension of {Governor} for 3 option fractional vote counting. When
 * voting, a delegate may split their vote weight between Against/For/Abstain.
 * This is most useful when the delegate is itself a contract, implementing its
 * own rules for voting. By allowing a contract-delegate to split its vote
 * weight, the voting preferences of many disparate token holders can be rolled
 * up into a single vote to the Governor itself. Some example use cases include
 * voting with tokens that are held by a DeFi pool, voting from L2 with tokens
 * held by a bridge, or voting privately from a shielded pool using zero
 * knowledge proofs.
 */
abstract contract GovernorCrossCountingFractionalUpgradeable is Initializable, GovernorUpgradeable {
    error GovernorCrossCountingFractionalUpgradeable_NoWeight();
    error GovernorCrossCountingFractionalUpgradeable_VoteWeightWouldExceedWeight();
    error GovernorCrossCountingFractionalUpgradeable_InvalidVoteData();
    error GovernorCrossCountingFractionalUpgradeable_SignatureAlreadyUsed();
    error GovernorCrossCountingFractionalUpgradeable_InvalidParamsForSigVote();

    struct ProposalVote {
        uint128 againstVotes;
        uint128 forVotes;
        uint128 abstainVotes;
    }

    function __GovernorCrossCountingFractional_init() internal onlyInitializing {}

    function __GovernorCrossCountingFractional_init_unchained() internal onlyInitializing {}

    /**
     * @dev Mapping from proposal ID to vote tallies for that proposal.
     */
    mapping(uint256 => ProposalVote) private _proposalVotes;

    /**
     * @dev Mapping a hash of the proposal ID, address and chain id to the weight the address
     * has cast on that proposal, e.g. _proposalVotersWeightCast[42][0xBEEF]
     * would tell you the number of votes that 0xBEEF has cast on proposal 42.
     */
    mapping(bytes32 => uint128) private _proposalVotersWeightCast;

    /**
     * @dev Mapping from voter address to signature-based vote nonce. The
     * voter's nonce increments each time a signature-based vote is cast with
     * fractional voting params and must be included in the `params` as the last
     * 16 bytes when signing for a fractional vote. Cannot be used for cross-chain voting
     */
    mapping(address => uint128) public fractionalVoteNonce;

    uint256[49] private __gap;

    /**
     * @dev See {IGovernor-COUNTING_MODE}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE() public pure virtual override returns (string memory) {
        return "support=bravo&quorum=for,abstain&params=fractional";
    }

    /**
     * @dev See {IGovernor-hasVoted}.
     */
    function hasVoted(uint256 proposalId, address account) public view virtual override returns (bool) {
        return _proposalVotersWeightCast[_getVoterKey(proposalId, account, block.chainid)] > 0;
    }

    // Chain-specific hasVoted
    function hasVotedChain(uint256 proposalId, address account, uint256 chainId) public view virtual returns (bool) {
        return _proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)] > 0;
    }

    /**
     * @dev Get the number of votes cast thus far on proposal `proposalId` by
     * account `account`. Useful for integrations that allow delegates to cast
     * rolling, partial votes.
     */
    function voteWeightCast(uint256 proposalId, address account) public view returns (uint128) {
        return _proposalVotersWeightCast[_getVoterKey(proposalId, account, block.chainid)];
    }

    /**
     * @dev Get the number of votes cast thus far on proposal `proposalId` by
     * account `account` on a specific chain. Useful for integrations that allow delegates to cast
     * rolling, partial votes.
     */
    function voteWeightCastChain(uint256 proposalId, address account, uint256 chainId) public view returns (uint128) {
        return _proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)];
    }

    /**
     * @dev Accessor to the internal vote counts.
     */
    function proposalVotes(uint256 proposalId) public view virtual returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        return (proposalVote.againstVotes, proposalVote.forVotes, proposalVote.abstainVotes);
    }

    /**
     * @dev See {Governor-_quorumReached}.
     */
    function _quorumReached(uint256 proposalId) internal view virtual override returns (bool) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        return quorum(proposalSnapshot(proposalId)) <= proposalVote.forVotes + proposalVote.abstainVotes;
    }

    /**
     * @dev See {Governor-_voteSucceeded}. In this module, forVotes must be > againstVotes.
     */
    function _voteSucceeded(uint256 proposalId) internal view virtual override returns (bool) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        return proposalVote.forVotes > proposalVote.againstVotes;
    }

    /**
     * @notice See {Governor-_countVote}.
     *
     * @dev Function that records the delegate's votes.
     *
     * If the `voteData` bytes parameter is empty, then this module behaves
     * identically to GovernorBravo. That is, it assigns the full weight of the
     * delegate to the `support` parameter, which follows the `VoteType` enum
     * from Governor Bravo.
     *
     * If the `voteData` bytes parameter is not zero, then it _must_ be three
     * packed uint128s, totaling 48 bytes, representing the weight the delegate
     * assigns to Against, For, and Abstain respectively, i.e.
     * `abi.encodePacked(againstVotes, forVotes, abstainVotes)`. The sum total of
     * the three decoded vote weights _must_ be less than or equal to the
     * delegate's remaining weight on the proposal, i.e. their checkpointed
     * total weight minus votes already cast on the proposal.
     *
     * See `_countVoteNominal` and `_countVoteFractional` for more details.
     */
    function _countVote(uint256 proposalId, address account, uint8 support, uint256 totalWeight, bytes memory voteData) internal virtual override {
        _countVote(proposalId, account, support, totalWeight, voteData, block.chainid);
    }

    /**
     * @dev Internal function that count votes for a specified chainId
     */
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 totalWeight,
        bytes memory voteData,
        uint256 chainId
    ) internal virtual {
        if (totalWeight == 0) revert GovernorCrossCountingFractionalUpgradeable_NoWeight();
        if (_proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)] >= totalWeight) {
            revert("GovernorCountingFractional: all weight cast");
        }

        uint128 safeTotalWeight = SafeCastUpgradeable.toUint128(totalWeight);

        if (voteData.length == 0) {
            _countVoteNominal(proposalId, account, safeTotalWeight, support, chainId);
        } else {
            _countVoteFractional(proposalId, account, safeTotalWeight, voteData, chainId);
        }
    }

    /**
     * @dev Record votes with full weight cast for `support`.
     *
     * Because this function votes with the delegate's full weight, it can only
     * be called once per proposal. It will revert if combined with a fractional
     * vote before or after.
     */
    function _countVoteNominal(uint256 proposalId, address account, uint128 totalWeight, uint8 support, uint256 chainId) internal {
        if (_proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)] != 0)
            revert GovernorCrossCountingFractionalUpgradeable_VoteWeightWouldExceedWeight();

        _proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)] = totalWeight;

        if (support == uint8(GovernorCompatibilityBravoUpgradeable.VoteType.Against)) {
            _proposalVotes[proposalId].againstVotes += totalWeight;
        } else if (support == uint8(GovernorCompatibilityBravoUpgradeable.VoteType.For)) {
            _proposalVotes[proposalId].forVotes += totalWeight;
        } else if (support == uint8(GovernorCompatibilityBravoUpgradeable.VoteType.Abstain)) {
            _proposalVotes[proposalId].abstainVotes += totalWeight;
        } else {
            revert("GovernorCountingFractional: invalid support value, must be included in VoteType enum");
        }
    }

    /**
     * @dev Count votes with fractional weight.
     *
     * `voteData` is expected to be three packed uint128s, i.e.
     * `abi.encodePacked(againstVotes, forVotes, abstainVotes)`.
     *
     * This function can be called multiple times for the same account and
     * proposal, i.e. partial/rolling votes are allowed. For example, an account
     * with total weight of 10 could call this function three times with the
     * following vote data:
     *   - against: 1, for: 0, abstain: 2
     *   - against: 3, for: 1, abstain: 0
     *   - against: 1, for: 1, abstain: 1
     * The result of these three calls would be that the account casts 5 votes
     * AGAINST, 2 votes FOR, and 3 votes ABSTAIN on the proposal. Though
     * partial, votes are still final once cast and cannot be changed or
     * overridden. Subsequent partial votes simply increment existing totals.
     *
     * Note that if partial votes are cast, all remaining weight must be cast
     * with _countVoteFractional: _countVoteNominal will revert.
     */
    function _countVoteFractional(uint256 proposalId, address account, uint128 totalWeight, bytes memory voteData, uint256 chainId) internal {
        if (voteData.length != 48) revert GovernorCrossCountingFractionalUpgradeable_InvalidVoteData();
        (uint128 _againstVotes, uint128 _forVotes, uint128 _abstainVotes) = _decodePackedVotes(voteData);

        uint128 _existingWeight = _proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)];
        uint256 _newWeight = uint256(_againstVotes) + _forVotes + _abstainVotes + _existingWeight;

        if (_newWeight > totalWeight) {
            revert GovernorCrossCountingFractionalUpgradeable_VoteWeightWouldExceedWeight();
        }
        // It's safe to downcast here because we've just confirmed that
        // _newWeight <= totalWeight, and totalWeight is a uint128.
        _proposalVotersWeightCast[_getVoterKey(proposalId, account, chainId)] = uint128(_newWeight);

        ProposalVote memory _proposalVote = _proposalVotes[proposalId];
        _proposalVote = ProposalVote(
            _proposalVote.againstVotes + _againstVotes,
            _proposalVote.forVotes + _forVotes,
            _proposalVote.abstainVotes + _abstainVotes
        );

        _proposalVotes[proposalId] = _proposalVote;
    }

    uint256 internal constant _MASK_HALF_WORD_RIGHT = 0xffffffffffffffffffffffffffffffff; // 128 bits of 0's, 128 bits of 1's

    /**
     * @dev Decodes three packed uint128's. Uses assembly because of a Solidity
     * language limitation which prevents slicing bytes stored in memory, rather
     * than calldata.
     */
    function _decodePackedVotes(bytes memory voteData) internal pure returns (uint128 againstVotes, uint128 forVotes, uint128 abstainVotes) {
        assembly {
            againstVotes := shr(128, mload(add(voteData, 0x20)))
            forVotes := and(_MASK_HALF_WORD_RIGHT, mload(add(voteData, 0x20)))
            abstainVotes := shr(128, mload(add(voteData, 0x40)))
        }
    }

    /**
     * @notice Cast a vote with a reason and additional encoded parameters using
     * the user's cryptographic signature.
     *
     * Emits a {VoteCast} or {VoteCastWithParams} event depending on the length
     * of params.
     *
     * @dev If casting a fractional vote via `params`, the voter's current nonce
     * must be appended to the `params` as the last 16 bytes and included in the
     * signature. I.e., the params used when constructing the signature would be:
     *
     *   abi.encodePacked(againstVotes, forVotes, abstainVotes, nonce)
     *
     * See {fractionalVoteNonce} and {_castVote} for more information.
     */
    function castVoteWithReasonAndParamsBySig(
        uint256 proposalId,
        uint8 support,
        string calldata reason,
        bytes memory params,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override returns (uint256) {
        // Signature-based fractional voting requires `params` be two full words
        // in length:
        //   16 bytes for againstVotes.
        //   16 bytes for forVotes.
        //   16 bytes for abstainVotes.
        //   16 bytes for the signature nonce.
        // Signature-based nominal voting requires `params` be 0 bytes.
        if (params.length != 64 && params.length != 0) {
            revert GovernorCrossCountingFractionalUpgradeable_InvalidParamsForSigVote();
        }

        address voter = ECDSAUpgradeable.recover(
            _hashTypedDataV4(keccak256(abi.encode(EXTENDED_BALLOT_TYPEHASH, proposalId, support, keccak256(bytes(reason)), keccak256(params)))),
            v,
            r,
            s
        );

        // If params are zero-length all of the voter's weight will be cast so
        // we don't have to worry about checking/incrementing a nonce.
        if (params.length == 64) {
            // Get the nonce out of the params. It is the last half-word.
            uint128 nonce;
            assembly {
                nonce := and(
                    // Perform bitwise AND operation on the data in the second word of
                    // `params` with a mask of 128 zeros followed by 128 ones, i.e. take
                    // the last 128 bits of `params`.
                    _MASK_HALF_WORD_RIGHT,
                    // Load the data from memory at the returned address.
                    mload(
                        // Skip the first 64 bytes (0x40):
                        //   32 bytes encoding the length of the bytes array.
                        //   32 bytes for the first word in the params
                        // Return the memory address for the last word in params.
                        add(params, 0x40)
                    )
                )
            }

            if (fractionalVoteNonce[voter] != nonce) {
                revert GovernorCrossCountingFractionalUpgradeable_SignatureAlreadyUsed();
            }

            fractionalVoteNonce[voter]++;

            // Trim params in place to keep only the first 48 bytes (which are
            // the voting params) and save gas.
            assembly {
                mstore(params, 0x30)
            }
        }

        return _castVote(proposalId, voter, support, reason, params);
    }

    function _getVoterKey(uint256 proposalId, address voter, uint256 chainId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(proposalId, voter, chainId));
    }
}
