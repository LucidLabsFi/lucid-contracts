// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {GovernanceSystemFactoryBase} from "./GovernanceSystemFactoryBase.sol";

import {ICREATE3Factory} from "../create3/ZeframLou/interfaces/ICREATE3Factory.sol";

/// @title GovernanceSystemFactoryZeframlou
/// @notice Factory contract using ZeframLou's Create3 factory to deploy Governor, Timelock and/or RefundGas contracts
contract GovernanceSystemFactoryZeframlou is GovernanceSystemFactoryBase {
    ICREATE3Factory public create3Factory;

    constructor(address _create3Factory) {
        create3Factory = ICREATE3Factory(_create3Factory);
    }

    function calculateDeployedAddress(bytes32 salt) external view override returns (address proxy) {
        proxy = create3Factory.getDeployed(address(this), salt);
        _verifyIsDeployed(proxy);
    }

    function _deployProxyCreate3(bytes memory bytecode, bytes32 salt) internal override returns (address) {
        return create3Factory.deploy(salt, bytecode);
    }
}
