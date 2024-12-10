// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {GovernanceSystemFactoryBase} from "./GovernanceSystemFactoryBase.sol";

import {IDeployer} from "../create3/Axelar/interfaces/IDeployer.sol";

/// @title GovernanceSystemFactoryAxelar
/// @notice Factory contract using Axelar's Create3 factory to deploy Governor, Timelock and/or RefundGas contracts
contract GovernanceSystemFactoryAxelar is GovernanceSystemFactoryBase {
    IDeployer public create3Factory;

    constructor(address _create3Factory) {
        create3Factory = IDeployer(_create3Factory);
    }

    function calculateDeployedAddress(bytes32 salt) external view override returns (address proxy) {
        proxy = create3Factory.deployedAddress(new bytes(0), address(this), salt);
        _verifyIsDeployed(proxy);
    }

    function _deployProxyCreate3(bytes memory bytecode, bytes32 salt) internal override returns (address) {
        return create3Factory.deploy(bytecode, salt);
    }
}
