// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ProxyAdmin, Ownable} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/// @title ProxyAdminFactory
/// @notice Factory contract to deploy ProxyAdmin contracts
contract ProxyAdminFactory {
    /// @notice Event emitted when a new ProxyAdmin is deployed
    /// @param proxyAdmin The address of the newly deployed ProxyAdmin contract
    /// @param caller The address of the deployer
    /// @param owner The address of the owner of the ProxyAdmin contract
    event AdminDeployed(address indexed proxyAdmin, address indexed caller, address indexed owner);

    /// @notice Mapping to keep track of deployed ProxyAdmin contracts
    mapping(address => bool) private _adminDeployed;

    /// @notice Deploys a new ProxyAdmin contract
    /// @param _initialOwner The address of the owner of the ProxyAdmin contract
    /// @return The address of the deployed contract
    function deployAdmin(address _initialOwner) external returns (address) {
        address admin = address(new ProxyAdmin());
        Ownable(admin).transferOwnership(_initialOwner);
        _adminDeployed[admin] = true;
        emit AdminDeployed(admin, msg.sender, _initialOwner);
        return admin;
    }

    /// @notice Checks if a contract is deployed
    /// @param _admin The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _admin) external view returns (bool) {
        return _adminDeployed[_admin];
    }
}
