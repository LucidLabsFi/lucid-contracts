// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {TokenVestingFlexVoting, TokenVesting} from "../extensions/TokenVestingFlexVoting.sol";

/// @title TokenVestingFactory
/// @notice Factory contract to deploy TokenVesting contracts
contract TokenVestingFactory {
    /// @notice Event emitted when a new vesting contract is deployed
    /// @param vestingContract The address of the newly deployed vesting contract
    /// @param caller The address of the deployer
    event VestingDeployed(address indexed vestingContract, address indexed caller);

    /// @notice Event emitted when a new vesting contract with flexible voting support is deployed
    /// @param vestingContract The address of the newly deployed vesting contract
    /// @param caller The address of the deployer
    event VestingFlexVotingDeployed(address indexed vestingContract, address indexed caller);

    /// @notice Mapping to keep track of deployed vesting contracts
    mapping(address => bool) private _vestingDeployed;

    /// @notice Deploys a new TokenVesting contract
    /// @param token The address of the token to be vested
    /// @return The address of the deployed contract
    function deployVesting(address token) external returns (address) {
        address vesting = address(new TokenVesting(token));
        _vestingDeployed[vesting] = true;
        emit VestingDeployed(vesting, msg.sender);
        return vesting;
    }

    /// @notice Deploys a new TokenVestingFlexVoting contract
    /// @param token The address of the token to be vested
    /// @return The address of the deployed contract
    function deployVestingFlexVoting(address token) external returns (address) {
        address vesting = address(new TokenVestingFlexVoting(token));
        _vestingDeployed[vesting] = true;
        emit VestingFlexVotingDeployed(vesting, msg.sender);
        return vesting;
    }

    /// @notice Checks if a contract is deployed
    /// @param _vesting The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _vesting) external view returns (bool) {
        return _vestingDeployed[_vesting];
    }
}
