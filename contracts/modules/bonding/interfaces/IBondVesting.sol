// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

interface IBondVesting {
    /**
     *
     * @notice Represents the vesting schedule for a beneficiary.
     * @param beneficiary The address that will receive the vested tokens
     * @param token The address of the ERC20 token being vested
     * @param cliff The cliff period (in seconds since UNIX epoch) before any tokens can be released
     * @param start The start time of the vesting schedule (in seconds since UNIX epoch)
     * @param duration The total duration of the vesting period (in seconds)
     * @param slicePeriodSeconds The interval (in seconds) at which portions of tokens are released
     * @param amountTotal The total amount of tokens to be vested over the entire schedule
     * @param released The amount of tokens that have already been released
     */
    struct VestingSchedule {
        address beneficiary;
        address token;
        uint256 cliff;
        uint256 start;
        uint256 duration;
        uint256 slicePeriodSeconds;
        uint256 amountTotal;
        uint256 released;
    }

    /**
     * @notice Creates a new vesting schedule for a beneficiary.
     * @param _beneficiary address of the beneficiary to whom vested tokens are transferred
     * @param _token address of the ERC20 token
     * @param _start start time of the vesting period
     * @param _cliff duration in seconds of the cliff in which tokens will begin to vest
     * @param _duration duration in seconds of the period in which the tokens will vest
     * @param _slicePeriodSeconds duration of a slice period for the vesting in seconds
     * @param _amount total amount of tokens to be released at the end of the vesting
     */
    function createVestingSchedule(
        address _beneficiary,
        address _token,
        uint256 _start,
        uint256 _cliff,
        uint256 _duration,
        uint256 _slicePeriodSeconds,
        uint256 _amount
    ) external;
}
