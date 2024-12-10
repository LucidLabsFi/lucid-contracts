// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {TokenVesting, SafeERC20, IERC20} from "./TokenVesting.sol";
import {FlexVotingClient} from "../modules/governor/FlexVotingClient.sol";

/**
 * @notice This contract is not compatible with quadratic voting strategies. It should not
 * be used with tokens that are governance tokens of governors using a quadratic voting strategy.
 * This is enforced on the FE side.
 * @title TokenVesting with Flex Voting support
 */
contract TokenVestingFlexVoting is TokenVesting, FlexVotingClient {
    using SafeERC20 for IERC20;

    /**
     * @notice Store the total raw balance of the tokens being tracked
     */
    uint256 public controlledTokens;

    /**
     * @param _token The token to be vested
     */
    constructor(address _token) TokenVesting(_token) FlexVotingClient(_token) {}

    /**
     * @notice Override createVestingSchedule to checkpoint the raw balance of the beneficiary once the schedule is created
     */
    function createVestingSchedule(ScheduleConfig[] memory schedules) public override {
        if (schedules.length == 0) revert Vesting_InvalidParams();
        uint256 sum;
        for (uint256 i = 0; i < schedules.length; i++) {
            ScheduleConfig memory _s = schedules[i];
            // perform input checks
            if ((_s.beneficiaries.length != _s.amounts.length) || (_s.beneficiaries.length == 0)) revert Vesting_InvalidParams();

            for (uint256 j = 0; j < _s.beneficiaries.length; j++) {
                address beneficiary = _s.beneficiaries[j];
                uint256 amount = _s.amounts[j];
                if (beneficiaryScheduleCount[beneficiary] >= MAX_SCHED_BENF) revert Vesting_MaxSchedulesReached();
                if ((beneficiary == address(0)) || (amount == 0)) revert Vesting_InvalidParams();
                sum += amount;
                beneficiaryScheduleCount[beneficiary]++;

                // create the vesting schedule and add it to the list of schedules for the beneficiary
                vestingSchedules[beneficiary].push(
                    VestingSchedule({beneficiary: beneficiary, start: _s.start, duration: _s.duration, amountTotal: amount, released: 0})
                );
                // Override: checkpoint the raw balance of the beneficiary
                _checkpointRawBalanceOf(beneficiary);
                emit VestingScheduleCreated(beneficiary, _s.start, _s.duration, amount);
            }
        }
        TOKEN.safeTransferFrom(msg.sender, address(this), sum);
        // Override: checkpoint the total raw balance of the controlled tokens
        controlledTokens += sum;
        _checkpointTotalRawBalance(controlledTokens);
    }

    /**
     * @notice Override release() to checkpoint the raw balance of the beneficiary once tokens are released
     */
    function release(address _beneficiary) public override returns (uint256) {
        uint256 released = super.release(_beneficiary);

        // Override: checkpoint the raw balance of the beneficiary
        _checkpointRawBalanceOf(_beneficiary);
        // Override: checkpoint the total raw balance of the controlled tokens
        controlledTokens -= released;
        _checkpointTotalRawBalance(controlledTokens);

        return released;
    }

    /**
     * @notice Necessary override for the FlexVotingClient
     * @dev Unvested tokens of a beneficiary can be used for voting
     * @param _user The address of the beneficiary
     */
    function _rawBalanceOf(address _user) internal view override returns (uint256) {
        return getVestingAmount(_user);
    }
}
