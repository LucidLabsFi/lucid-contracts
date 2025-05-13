// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @title ProxyFactory
/// @notice Factory contract to deploy TransparentUpgradeableProxy contracts
contract ProxyFactory {
    /// @notice Event emitted when a new proxy is deployed
    /// @param proxy The address of the newly deployed proxy contract
    /// @param logic The address of the logic contract
    /// @param caller The address of the deployer
    /// @param proxyAdmin The address of the proxy admin
    /// @param data The data to be used for the proxy
    event ProxyDeployed(address indexed proxy, address indexed logic, address indexed caller, address proxyAdmin, bytes data);

    /// @notice Mapping to keep track of deployed proxies
    mapping(address => bool) private _proxyDeployed;

    /// @notice Deploys a new TransparentUpgradeableProxy contract
    /// @param _logic The address of the logic contract
    /// @param _proxyAdmin The address of the proxy admin
    /// @param _data The data to be used for the proxy
    /// @return The address of the deployed contract
    function deployProxy(address _logic, address _proxyAdmin, bytes memory _data) external returns (address) {
        address proxy = address(new TransparentUpgradeableProxy(_logic, _proxyAdmin, _data));
        emit ProxyDeployed(proxy, _logic, msg.sender, _proxyAdmin, _data);
        _proxyDeployed[proxy] = true;
        return proxy;
    }

    /// @notice Checks if a contract is deployed
    /// @param _proxy The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _proxy) external view returns (bool) {
        return _proxyDeployed[_proxy];
    }
}
