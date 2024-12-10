// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IGovernorTimelock} from "@openzeppelin/contracts/governance/extensions/IGovernorTimelock.sol";

import {IRefundGas} from "./interfaces/IRefundGas.sol";

/// @title GovernanceSystemFactoryBase
/// @notice Factory contract to deploy Governor, Timelock and/or RefundGas contracts
abstract contract GovernanceSystemFactoryBase {
    error Factory_InvalidTimelockAddress();
    error Factory_InvalidGovernorAddress();
    error Factory_SaltAlreadyUsed();

    event RefundGasProxyDeployed(address refundGas, bytes32 salt);
    event TimelockProxyDeployed(address timelock, bytes32 salt);
    event GovernorProxyDeployed(address governor, bytes32 salt);

    bytes32 public constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    /// @notice Mapping to keep track of deployed contracts
    mapping(address => bool) public isDeployed;

    function initialiseGovernanceSystem(
        bytes memory governorArgs,
        bytes memory timelockArgs,
        bytes memory refundArgs,
        bytes32[3] memory salts,
        address canceller
    ) external returns (address governor, address timelock, address refundGas) {
        if (refundArgs.length != 0) {
            // Deploy RefundGas contract
            refundGas = _encodeAndDeploy(refundArgs, salts[2]);
            emit RefundGasProxyDeployed(refundGas, salts[2]);
        }

        if (timelockArgs.length != 0) {
            // Deploy Timelock contract
            timelock = _encodeAndDeploy(timelockArgs, salts[1]);
            emit TimelockProxyDeployed(timelock, salts[1]);
        }

        // Deploy Governor contract
        governor = _encodeAndDeploy(governorArgs, salts[0]);
        emit GovernorProxyDeployed(governor, salts[0]);

        // Validate storred addresses
        _validateAddresses(governor, timelock, refundGas);

        // Configure Timelock
        if (timelock != address(0)) {
            IAccessControl(timelock).grantRole(PROPOSER_ROLE, governor);
            IAccessControl(timelock).grantRole(EXECUTOR_ROLE, address(0));
            IAccessControl(timelock).grantRole(CANCELLER_ROLE, canceller);
            IAccessControl(timelock).grantRole(TIMELOCK_ADMIN_ROLE, governor);
            IAccessControl(timelock).revokeRole(TIMELOCK_ADMIN_ROLE, address(this));
        }
    }

    function _validateAddresses(address governor, address timelock, address refundGas) internal view {
        if (timelock != address(0)) {
            // check timelock address in governor
            if (IGovernorTimelock(governor).timelock() != timelock) revert Factory_InvalidTimelockAddress();
        }

        if (refundGas != address(0)) {
            // check governor address in refundGas
            if (IRefundGas(refundGas).governor() != governor) revert Factory_InvalidGovernorAddress();
            // if (IRefundGas(refundGas).owner() != governor) revert Factory_InvalidGovernorAddress();
        }
    }

    function _encodeAndDeploy(bytes memory constructorArgs, bytes32 salt) internal returns (address proxy) {
        bytes memory bytecode = abi.encodePacked(type(TransparentUpgradeableProxy).creationCode, constructorArgs);
        proxy = _deployProxyCreate3(bytecode, salt);
    }

    function _verifyIsDeployed(address _contract) internal view {
        if (isDeployed[_contract]) revert Factory_SaltAlreadyUsed();
    }

    function calculateDeployedAddress(bytes32 salt) external view virtual returns (address proxy);

    function _deployProxyCreate3(bytes memory bytecode, bytes32 salt) internal virtual returns (address);
}
