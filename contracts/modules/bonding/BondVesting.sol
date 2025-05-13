// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {IBondVesting} from "./interfaces/IBondVesting.sol";

/**
 * @title BondVesting
 */
contract BondVesting is IBondVesting {
    event VestingScheduleCreated(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        address indexed token,
        uint256 cliff,
        uint256 start,
        uint256 duration,
        uint256 slicePeriodSeconds,
        uint256 amountTotal
    );
    event TokensReleased(bytes32 indexed vestingScheduleId, address indexed beneficiary, uint256 amount);

    uint256 private vestingSchedulesTotalAmount;
    bytes32[] private vestingSchedulesIds;
    mapping(address => mapping(bytes32 => VestingSchedule)) private vestingSchedules;
    mapping(address => uint256) private vestingSchedulesTotalAmountByToken;
    mapping(address => uint256) private holdersVestingCount;

    /**
     * @dev Reverts if the vesting schedule does not exist
     */
    modifier onlyIfVestingScheduleExists(address token, bytes32 vestingScheduleId) {
        require(vestingSchedules[token][vestingScheduleId].duration > 0);
        _;
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
    ) external {
        require(_duration > 0, "TokenVesting: duration must be > 0");
        require(_amount > 0, "TokenVesting: amount must be > 0");
        require(_slicePeriodSeconds >= 1, "TokenVesting: slicePeriodSeconds must be >= 1");
        require(_duration >= _cliff, "TokenVesting: duration must be >= cliff");
        require(_beneficiary != address(0), "TokenVesting: beneficiary cannot be the zero address");
        require(_token != address(0), "TokenVesting: token cannot be the zero address");
        bytes32 vestingScheduleId = computeNextVestingScheduleIdForHolder(_beneficiary);
        uint256 cliff = _start + _cliff;
        vestingSchedules[_token][vestingScheduleId] = VestingSchedule(
            _beneficiary,
            _token,
            cliff,
            _start,
            _duration,
            _slicePeriodSeconds,
            _amount,
            0
        );
        vestingSchedulesTotalAmount = vestingSchedulesTotalAmount + _amount;
        vestingSchedulesTotalAmountByToken[_token] = vestingSchedulesTotalAmountByToken[_token] + _amount;
        vestingSchedulesIds.push(vestingScheduleId);
        uint256 currentVestingCount = holdersVestingCount[_beneficiary];
        holdersVestingCount[_beneficiary] = currentVestingCount + 1;

        SafeTransferLib.safeTransferFrom(ERC20(_token), msg.sender, address(this), _amount);

        emit VestingScheduleCreated(vestingScheduleId, _beneficiary, _token, cliff, _start, _duration, _slicePeriodSeconds, _amount);
    }

    /**
     * @notice Release vested amount of tokens.
     * @param token the address of the token
     * @param vestingScheduleId the vesting schedule identifier
     */
    function release(address token, bytes32 vestingScheduleId) public onlyIfVestingScheduleExists(token, vestingScheduleId) {
        VestingSchedule storage vestingSchedule = vestingSchedules[token][vestingScheduleId];
        bool isBeneficiary = msg.sender == vestingSchedule.beneficiary;

        require(isBeneficiary, "TokenVesting: only beneficiary can release vested tokens");
        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);

        vestingSchedule.released = vestingSchedule.released + vestedAmount;
        address beneficiary = vestingSchedule.beneficiary;

        vestingSchedulesTotalAmount = vestingSchedulesTotalAmount - vestedAmount;
        SafeTransferLib.safeTransfer(ERC20(token), beneficiary, vestedAmount);

        emit TokensReleased(vestingScheduleId, vestingSchedule.beneficiary, vestedAmount);
    }

    /**
     * @dev Returns the number of vesting schedules associated to a beneficiary.
     * @return the number of vesting schedules
     */
    function getVestingSchedulesCountByBeneficiary(address _beneficiary) external view returns (uint256) {
        return holdersVestingCount[_beneficiary];
    }

    /**
     * @dev Returns the vesting schedule id at the given index.
     * @return the vesting id
     */
    function getVestingIdAtIndex(uint256 index) external view returns (bytes32) {
        require(index < getVestingSchedulesCount(), "TokenVesting: index out of bounds");
        return vestingSchedulesIds[index];
    }

    /**
     * @notice Returns the vesting schedule information for a given token, holder and index.
     * @param token the address of the token
     * @param holder the address of the holder
     * @return the vesting schedule structure information
     */
    function getVestingScheduleByAddressAndIndex(address token, address holder, uint256 index) external view returns (VestingSchedule memory) {
        return getVestingSchedule(token, computeVestingScheduleIdForAddressAndIndex(holder, index));
    }

    /**
     * @notice Returns the total amount of vesting schedules.
     * @return the total amount of vesting schedules
     */
    function getVestingSchedulesTotalAmount() external view returns (uint256) {
        return vestingSchedulesTotalAmount;
    }

    /**
     * @dev Returns the number of vesting schedules managed by this contract.
     * @return the number of vesting schedules
     */
    function getVestingSchedulesCount() public view returns (uint256) {
        return vestingSchedulesIds.length;
    }

    /**
     * @notice Returns the total amount of vesting schedules by token.
     * @return the total amount of vesting schedules
     */
    function getVestingSchedulesTotalAmountByToken(address token) external view returns (uint256) {
        return vestingSchedulesTotalAmountByToken[token];
    }

    /**
     * @notice Computes the vested amount of tokens for the given token address and vesting schedule identifier.
     * @param token the address of the token
     * @param vestingScheduleId the vesting schedule identifier
     * @return the vested amount
     */
    function computeReleasableAmount(
        address token,
        bytes32 vestingScheduleId
    ) external view onlyIfVestingScheduleExists(token, vestingScheduleId) returns (uint256) {
        VestingSchedule storage vestingSchedule = vestingSchedules[token][vestingScheduleId];
        return _computeReleasableAmount(vestingSchedule);
    }

    /**
     * @notice Returns the vesting schedule information for a given identifier and token address.
     * @param token the address of the token
     * @param vestingScheduleId the vesting schedule identifier
     * @return the vesting schedule structure information
     */
    function getVestingSchedule(address token, bytes32 vestingScheduleId) public view returns (VestingSchedule memory) {
        return vestingSchedules[token][vestingScheduleId];
    }

    /**
     * @dev Computes the next vesting schedule identifier for a given holder address.
     */
    function computeNextVestingScheduleIdForHolder(address holder) public view returns (bytes32) {
        return computeVestingScheduleIdForAddressAndIndex(holder, holdersVestingCount[holder]);
    }

    /**
     * @dev Returns the last vesting schedule for a given token and holder addresses.
     */
    function getLastVestingScheduleForHolder(address token, address holder) external view returns (VestingSchedule memory) {
        return vestingSchedules[token][computeVestingScheduleIdForAddressAndIndex(holder, holdersVestingCount[holder] - 1)];
    }

    /**
     * @dev Computes the vesting schedule identifier for an address and an index.
     */
    function computeVestingScheduleIdForAddressAndIndex(address holder, uint256 index) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(holder, index));
    }

    /**
     * @dev Computes the releasable amount of tokens for a vesting schedule.
     * @return the amount of releasable tokens
     */
    function _computeReleasableAmount(VestingSchedule memory vestingSchedule) internal view returns (uint256) {
        // Retrieve the current time.
        uint256 currentTime = getCurrentTime();
        // If the current time is before the cliff, no tokens are releasable.
        if ((currentTime < vestingSchedule.cliff)) {
            return 0;
        }
        // If the current time is after the vesting period, all tokens are releasable,
        // minus the amount already released.
        else if (currentTime >= vestingSchedule.cliff + vestingSchedule.duration) {
            return vestingSchedule.amountTotal - vestingSchedule.released;
        }
        // Otherwise, some tokens are releasable.
        else {
            // Compute the number of full vesting periods that have elapsed.
            uint256 timeFromStart = currentTime - vestingSchedule.cliff;
            uint256 secondsPerSlice = vestingSchedule.slicePeriodSeconds;
            uint256 vestedSlicePeriods = timeFromStart / secondsPerSlice;
            uint256 vestedSeconds = vestedSlicePeriods * secondsPerSlice;
            // Compute the amount of tokens that are vested.
            uint256 vestedAmount = (vestingSchedule.amountTotal * vestedSeconds) / vestingSchedule.duration;
            // Subtract the amount already released and return.
            return vestedAmount - vestingSchedule.released;
        }
    }

    /**
     * @dev Returns the current time.
     * @return the current timestamp in seconds.
     */
    function getCurrentTime() internal view virtual returns (uint256) {
        return block.timestamp;
    }
}
