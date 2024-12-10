// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TokenVesting
 * @notice A simple vesting contract that allows to create vesting schedules for a beneficiary with linear or cliff vesting.
 * @author andreitoma8, zmitzie
 */
contract TokenVesting {
    using SafeERC20 for IERC20;

    /**
     * @notice Error thrown when the input parameters are invalid, like zero address, empty array, etc.
     */
    error Vesting_InvalidParams();

    /**
     * @notice Error thrown when there are no vesting schedules for a beneficiary
     */
    error Vesting_NoVestingSchedules();

    /**
     * @notice Error thrown when the maximum number of schedules per beneficiary is reached
     */
    error Vesting_MaxSchedulesReached();

    /**
     * @notice Emitted when a vesting schedule is created
     * @param beneficiary The address of the beneficiary
     * @param start The start UNIX timestamp of the vesting period
     * @param duration The duration of the vesting period in DurationUnits
     */
    event VestingScheduleCreated(address indexed beneficiary, uint256 start, uint256 duration, uint256 amountTotal);

    /**
     * @notice Emitted when tokens are released
     * @param beneficiary The address of the beneficiary
     * @param amount The amount of tokens released
     */
    event TokensReleased(address indexed beneficiary, uint256 amount);

    /**
     * @notice Vesting schedule for a beneficiary
     * @param beneficiary The address of the beneficiary
     * @param start The start time of the vesting period in UNIX timestamp
     * @param duration The duration of the vesting period in seconds
     * @param amountTotal The total amount of tokens to be released at the end of the vesting
     * @param released The amount of tokens released
     */
    struct VestingSchedule {
        address beneficiary;
        uint256 start;
        uint256 duration;
        uint256 amountTotal;
        uint256 released;
    }

    /**
     * @notice Configuration for a vesting schedule, used to create new schedules
     * @param beneficiaries The addresses of the beneficiaries
     * @param amounts The amount of tokens for each of the beneficiaries
     * @param start The start UNIX timestamp of the vesting period
     * @param duration The duration of the vesting period in seconds
     */
    struct ScheduleConfig {
        address[] beneficiaries;
        uint256[] amounts;
        uint256 start;
        uint256 duration;
    }

    /**
     * @notice The token to be vested
     */
    IERC20 public immutable TOKEN;

    /**
     * @notice Maximum number of schedules per beneficiary
     */
    uint256 public constant MAX_SCHED_BENF = 50;

    /**
     * @notice List of vesting schedules for each beneficiary
     */
    mapping(address => VestingSchedule[]) public vestingSchedules;

    /**
     * @notice Number of vesting schedules for each beneficiary
     */
    mapping(address => uint256) public beneficiaryScheduleCount;

    /**
     * @param _token The token to be vested
     */
    constructor(address _token) {
        TOKEN = IERC20(_token);
    }

    /**
     * @notice Creates a vesting schedule
     * @dev Approve in the token contract to transfer the total number of tokens that will be vested before calling this function
     * @notice If you first want a cliff and then a linear vesting, set the start time to the cliff time
     * @param schedules An array of ScheduleConfig structs, each containing the beneficiaries, amounts, start time and duration
     */
    function createVestingSchedule(ScheduleConfig[] memory schedules) public virtual {
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

                emit VestingScheduleCreated(beneficiary, _s.start, _s.duration, amount);
            }
        }
        TOKEN.safeTransferFrom(msg.sender, address(this), sum);
    }

    /**
     * @notice Releases the vested tokens for a beneficiary
     * @dev The function goes through all the schedules of the specified beneficiary, calculate the amount of tokens to be claimed and transfer them to the user
     * @param _beneficiary The address of the beneficiary
     */
    function release(address _beneficiary) public virtual returns (uint256) {
        VestingSchedule[] storage schedules = vestingSchedules[_beneficiary];
        uint256 schedulesLength = schedules.length;
        if (schedulesLength == 0) revert Vesting_NoVestingSchedules();

        uint256 totalRelease;

        for (uint256 i = 0; i < schedulesLength; i++) {
            VestingSchedule storage schedule = schedules[i];

            // calculate the releasable amount
            uint256 amountToSend = releasableAmount(schedule);
            if (amountToSend > 0) {
                // update the released amount
                schedule.released += amountToSend;
                // update the total released amount
                totalRelease += amountToSend;
                // transfer the tokens to the beneficiary
                TOKEN.safeTransfer(schedule.beneficiary, amountToSend);
            }
        }

        emit TokensReleased(_beneficiary, totalRelease);
        return totalRelease;
    }

    /**
     * @notice Returns the releasable amount of tokens for a beneficiary
     * @param _beneficiary The address of the beneficiary
     */
    function getReleaseableAmount(address _beneficiary) external view returns (uint256) {
        VestingSchedule[] memory schedules = vestingSchedules[_beneficiary];
        if (schedules.length == 0) return 0;

        uint256 amountToSend = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            VestingSchedule memory schedule = vestingSchedules[_beneficiary][i];
            amountToSend += releasableAmount(schedule);
        }
        return amountToSend;
    }

    /**
     * @notice Returns the total amount of tokens to be vested for a beneficiary, minus the amount already released
     * @param _beneficiary The address of the beneficiary
     */
    function getVestingAmount(address _beneficiary) public view returns (uint256) {
        VestingSchedule[] memory schedules = vestingSchedules[_beneficiary];
        if (schedules.length == 0) return 0;

        uint256 vestingAmount = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            VestingSchedule memory schedule = vestingSchedules[_beneficiary][i];
            vestingAmount += schedule.amountTotal - schedule.released;
        }
        return vestingAmount;
    }

    /**
     * @notice Returns the releasable amount of tokens for a vesting schedule
     * @param _schedule The vesting schedule
     */
    function releasableAmount(VestingSchedule memory _schedule) public view returns (uint256) {
        return vestedAmount(_schedule) - _schedule.released;
    }

    /**
     * @notice Returns the vested amount of tokens for a vesting schedule
     * @param _schedule The vesting schedule
     */

    function vestedAmount(VestingSchedule memory _schedule) public view returns (uint256) {
        if (_schedule.duration == 0) {
            if (block.timestamp >= _schedule.start) {
                return _schedule.amountTotal;
            } else {
                return 0;
            }
        }

        if (block.timestamp < _schedule.start) {
            return 0;
        } else if (block.timestamp >= _schedule.start + _schedule.duration) {
            return _schedule.amountTotal;
        } else {
            uint256 timePassed = block.timestamp - _schedule.start;
            return (_schedule.amountTotal * timePassed) / _schedule.duration;
        }
    }
}
