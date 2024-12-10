// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {GovernorUpgradeable, IGovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {GovernorSettingsUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {GovernorVotesQuorumFractionUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import {GovernorVotesUpgradeable, IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {GovernorTimelockControlUpgradeable, TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";

import {VetoUpgradeable} from "./extensions/VetoUpgradeable.sol";
import {IRefundGasUpgradeable} from "./interfaces/IRefundGasUpgradeable.sol";
import {GovernorCrossCountingFractionalUpgradeable} from "./extensions/GovernorCrossCountingFractionalUpgradeable.sol";
import {IStrategy} from "./strategies/interfaces/IStrategy.sol";

/**
 * @title LucidGovernorTimelock
 * @dev Extension of OZ Governor that supports cross-chain voting, veto, gas refunds for voters, Flexible Voting's fractional voting  and custom voting strategies
 */
contract LucidGovernorTimelock is
    Initializable,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCrossCountingFractionalUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable,
    GovernorTimelockControlUpgradeable,
    VetoUpgradeable
{
    /**
     * @notice Error thrown when cross-chain voting parameters are incorrect
     */
    error Governor_WrongParams();

    /**
     * @notice Error thrown when array lengths do not match
     */
    error Governor_ArrayMismatch();

    /**
     * @notice The strategy contract that calculates the voting power
     */
    IStrategy public strategy;

    /**
     * @notice The refund gas contract that refunds gas to voters
     */
    address public refundGas;

    /**
     * @notice The local adapter contract that can call castCrossChainVote.
     * @dev Set to zero address to disable cross-chain voting
     */
    address public adapter;

    /**
     * @notice The mapping of chain ids to token addresses used for cross-chain voting
     */
    mapping(uint256 => address) public chainTokens;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param _token The IVotes compatible token contract
     * @param _timelock The TimelockController contract
     * @param _name The name of the governor
     * @param _govSettings The governor settings [votingDelay, votingPeriod, proposalThreshold, quorumPct]. Voting delay and voting period is calculated in blocks, not seconds. You need to account for the avg block time of your chain.
     * @param _addresses The addresses [vetoer, refundGas, adapter, strategy]. Set to zero address to disable any of the features, except strategy
     * @param _chainTokens The token addresses in other chains used for cross-chain voting
     * @param _chainIds The chain ids for the tokens specified in _chainTokens
     */
    function initialize(
        IVotesUpgradeable _token,
        TimelockControllerUpgradeable _timelock,
        string memory _name,
        uint256[4] memory _govSettings, // votingDelay, votingPeriod, proposalThreshold, quorumPct
        address[4] memory _addresses, //_vetoer, _refundGas, adapter (zero address if disabled), strategy
        address[] memory _chainTokens,
        uint256[] memory _chainIds
    ) public initializer {
        __Governor_init(_name);
        __GovernorSettings_init(_govSettings[0], _govSettings[1], _govSettings[2]); // votingDelay, votingPeriod, proposalThreshold
        __GovernorCrossCountingFractional_init();
        __GovernorVotes_init(_token);
        __GovernorVotesQuorumFraction_init(_govSettings[3]); // in pct
        __GovernorTimelockControl_init(_timelock);
        __Veto_init(_addresses[0]);
        refundGas = _addresses[1];
        adapter = _addresses[2];
        strategy = IStrategy(_addresses[3]);

        // Configure tokens from other chains to be used for cross-chain voting
        if (_chainTokens.length > 0) {
            if (_chainTokens.length != _chainIds.length) revert Governor_ArrayMismatch();
            for (uint i = 0; i < _chainTokens.length; i++) {
                chainTokens[_chainIds[i]] = _chainTokens[i];
            }
        }
    }

    /**
     * @dev See {IGovernor-quorum}.
     */
    function quorum(uint256 blockNumber) public view override(IGovernorUpgradeable, GovernorVotesQuorumFractionUpgradeable) returns (uint256) {
        return strategy.quorum(blockNumber);
    }

    // The following functions are overrides required by Solidity.

    /**
     * @dev See {IGovernor-votingDelay}.
     */
    function votingDelay() public view override(IGovernorUpgradeable, GovernorSettingsUpgradeable) returns (uint256) {
        return super.votingDelay();
    }

    /**
     * @dev See {IGovernor-votingPeriod}.
     */
    function votingPeriod() public view override(IGovernorUpgradeable, GovernorSettingsUpgradeable) returns (uint256) {
        return super.votingPeriod();
    }

    /**
     * @dev See {IGovernor-proposalThreshold}.
     */
    function proposalThreshold() public view override(GovernorUpgradeable, GovernorSettingsUpgradeable) returns (uint256) {
        return super.proposalThreshold();
    }

    /**
     * @dev Overwritten GovernorVotes implementation to redirect to the strategy contract
     */
    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory /*params*/
    ) internal view virtual override(GovernorUpgradeable, GovernorVotesUpgradeable) returns (uint256) {
        return strategy.getVotes(account, timepoint, "");
    }

    /**
     * @dev See {IGovernor-state}.
     */
    function state(uint256 proposalId) public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (ProposalState) {
        return super.state(proposalId);
    }

    /**
     * @dev See {IGovernor-propose}. This function has opt-in frontrunning protection, described in {_isValidDescriptionForProposer}.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(GovernorUpgradeable, IGovernorUpgradeable) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    /**
     * @dev See {IGovernor-queue}.
     */
    function queue(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public override returns (uint256) {
        return super.queue(targets, values, calldatas, descriptionHash);
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (address) {
        return super._executor();
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev See {IGovernor-castVote}.
     */
    function castVote(uint256 proposalId, uint8 support) public override(GovernorUpgradeable, IGovernorUpgradeable) returns (uint256) {
        uint256 startGas = gasleft();
        address voter = _msgSender();
        uint res = super._castVote(proposalId, voter, support, "");
        if (refundGas != address(0)) {
            IRefundGasUpgradeable(refundGas).refundGas(payable(voter), startGas);
        }
        return res;
    }

    /**
     * @dev See {IGovernor-castVoteWithReason}.
     */
    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) public override(GovernorUpgradeable, IGovernorUpgradeable) returns (uint256) {
        // Calling castVoteWithReasonAndParams with _defaultParams() to reduce contract size
        return castVoteWithReasonAndParams(proposalId, support, reason, _defaultParams());
    }

    /**
     * @dev See {IGovernor-castVoteWithReasonAndParams}.
     */
    function castVoteWithReasonAndParams(
        uint256 proposalId,
        uint8 support,
        string calldata reason,
        bytes memory params
    ) public override(IGovernorUpgradeable, GovernorUpgradeable) returns (uint256) {
        uint256 startGas = gasleft();
        address voter = _msgSender();
        uint res = super._castVote(proposalId, voter, support, reason, params);
        if (refundGas != address(0)) {
            IRefundGasUpgradeable(refundGas).refundGas(payable(voter), startGas);
        }
        return res;
    }

    /**
     * @dev We override this function to resolve ambiguity between inherited contracts.
     * @dev See {IGovernor-castVoteWithReasonAndParams}.
     */
    function castVoteWithReasonAndParamsBySig(
        uint256 proposalId,
        uint8 support,
        string calldata reason,
        bytes memory params,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override(IGovernorUpgradeable, GovernorUpgradeable, GovernorCrossCountingFractionalUpgradeable) returns (uint256) {
        return GovernorCrossCountingFractionalUpgradeable.castVoteWithReasonAndParamsBySig(proposalId, support, reason, params, v, r, s);
    }

    /**
     * @notice Cast a vote for a proposal cross-chain via a trusted controller
     * @dev Should be called by the adapter contract
     * @param chainId The origin chain id
     * @param voter The address of the voter
     * @param voteWeight The weight of the vote
     * @param sourceToken The token address in the origin chain
     * @param timepoint The snapshot timestamp of the proposal
     * @param proposalId The id of the proposal
     * @param support The vote direction
     * @param voteData Additional data for the vote (not implemented)
     */
    function castCrossChainVote(
        uint256 chainId,
        address voter,
        uint256 voteWeight,
        address sourceToken,
        uint256 timepoint,
        uint256 proposalId,
        uint8 support,
        bytes memory voteData
    ) external {
        if (
            (adapter != msg.sender) ||
            (state(proposalId) != ProposalState.Active) ||
            (proposalSnapshot(proposalId) != timepoint) ||
            (chainTokens[chainId] != sourceToken)
        ) revert Governor_WrongParams();

        uint256 votes = strategy.getVotesForWeight(voter, voteWeight);
        _countVote(proposalId, voter, support, votes, voteData, chainId);
        emit VoteCastWithParams(voter, proposalId, support, votes, "", voteData);
    }

    /**
     * @notice Set the token address for a chain that can be used to vote cross-chain
     * @dev Should be called by the governance contract via a governance proposal
     * @param chainId The chain id
     * @param token The token address
     */
    function setChainToken(uint256 chainId, address token) public onlyGovernance {
        chainTokens[chainId] = token;
    }

    /**
     * @notice Update the governor settings
     * @notice Should be called by the governance contract via a governance proposal
     * @notice Pass the existing values in order to update only the required fields
     * @param _adapter The new adapter contract
     * @param _refundGas The new refund gas contract
     * @param _strategy The new strategy contract
     */
    function updateSettings(address _adapter, address _refundGas, address _strategy) public onlyGovernance {
        adapter = _adapter;
        refundGas = _refundGas;
        strategy = IStrategy(_strategy);
    }
}
