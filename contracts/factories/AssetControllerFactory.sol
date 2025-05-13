// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AssetController} from "../modules/chain-abstraction/AssetController.sol";

/// @title AssetControllerFactory
/// @notice Factory contract to deploy AssetController contracts
contract AssetControllerFactory {
    /// @notice Event emitted when a new controller is deployed
    /// @param controller The address of the newly deployed controller contract
    /// @param token The address of the token used in the controller
    /// @param deployer The address of the deployer
    event ControllerDeployed(address controller, address token, address deployer);

    /// @notice Mapping to keep track of deployed controllers
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new AssetController contract
    /// @param addresses Array of addresses: [token, initialOwner, pauser, feeCollector, controllerAddress]
    /// @param duration The duration of the controller
    /// @param minBridges The minimum number of bridges required
    /// @param multiBridgeAdapters Array of whitelisted multi-bridge adapters
    /// @param chainId Array of chain IDs
    /// @param bridges Array of bridge addresses
    /// @param mintingLimits Array of minting limits
    /// @param burningLimits Array of burning limits
    /// @param selectors Array of function selectors for mint and burn functions on the token
    function deployController(
        address[5] memory addresses, // token, initialOwner, pauser, feeCollector, controllerAddress
        uint256 duration,
        uint256 minBridges,
        address[] memory multiBridgeAdapters,
        uint256[] memory chainId,
        address[] memory bridges,
        uint256[] memory mintingLimits,
        uint256[] memory burningLimits,
        bytes4[2] memory selectors
    ) external returns (address) {
        address controller = address(
            new AssetController(addresses, duration, minBridges, multiBridgeAdapters, chainId, bridges, mintingLimits, burningLimits, selectors)
        );
        emit ControllerDeployed(controller, addresses[0], msg.sender);
        isDeployed[controller] = true;
        return controller;
    }

    /// @notice Checks if a contract is deployed
    /// @param _contract The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
