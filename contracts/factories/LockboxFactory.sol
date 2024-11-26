// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {XERC20Lockbox} from "../tokens/ERC20/XERC20Lockbox.sol";

/// @title LockboxFactory
/// @notice Factory contract to deploy XERC20Lockbox contracts
contract LockboxFactory {
    /// @notice Event emitted when a new lockbox is deployed
    /// @param token The address of the token used in the lockbox
    /// @param _xerc20 The address of the XERC20 token
    /// @param caller The address of the deployer
    event LockboxDeployed(address token, address _xerc20, address caller);

    /// @notice Mapping to keep track of deployed lockboxes
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new XERC20Lockbox contract
    /// @param _xerc20 The address of the XERC20 token
    /// @param _erc20 The address of the ERC20 token
    /// @param _isNative Whether the ERC20 token is the native gas token of this chain
    /// @return The address of the deployed contract
    function deployToken(address _xerc20, address _erc20, bool _isNative) external returns (address) {
        address lockbox = address(new XERC20Lockbox(_xerc20, _erc20, _isNative));
        emit LockboxDeployed(lockbox, _xerc20, msg.sender);
        isDeployed[lockbox] = true;
        return lockbox;
    }

    /// @notice Checks if a contract is deployed
    /// @param _contract The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
