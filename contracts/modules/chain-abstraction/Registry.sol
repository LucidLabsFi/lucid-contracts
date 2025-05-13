// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Ownable2StepInit, OwnableInit} from "../../utils/access/Ownable2StepInit.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IBaseAdapter} from "./adapters/interfaces/IBaseAdapter.sol";

/**
 * @title Registry
 * @dev A registry of local adapters maintained by Lucid with enable/disable functionality for admins.
 * @notice It can be used by MessageControllers, but it also acts as an aggregator of available chains and adapters accessible from the current chain
 */
contract Registry is Ownable2StepInit {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice Event emitted when an adapter is enabled or disabled
    event AdapterSet(address adapter, bool enabled);

    /// @notice Error when the parameters are invalid
    error Registry_Invalid_Params();
    /// @notice Error when the address provided is not an adapter
    error Registry_NotAdapter();

    /// @dev Set of all adapter addresses
    EnumerableSet.AddressSet private _adapterSet;

    /// @dev List of all potential available chain ids
    uint256[] private _chainIds;

    /**
     * @notice Constructor to initialize the registry with a list of adapters
     * @param adapters The list of adapter addresses to be enabled initially
     */
    constructor(address[] memory adapters, address owner) OwnableInit(owner) {
        for (uint256 i = 0; i < adapters.length; i++) {
            _adapterSet.add(adapters[i]);
            emit AdapterSet(adapters[i], true);
        }
    }

    /**
     * @notice Checks if an address is a local adapter
     * @param adapter The address to check
     * @return bool True if the address is a local adapter, false otherwise
     */
    function isLocalAdapter(address adapter) external view returns (bool) {
        return _adapterSet.contains(adapter);
    }

    /**
     * @notice Returns all the of adapters in the registry
     * @return address[] The list of adapter addresses
     */
    function getAdapters() external view returns (address[] memory) {
        return _adapterSet.values();
    }

    /**
     * @notice Returns the number of adapters in the registry
     * @return uint256 The number of adapters
     */
    function getAdapterCount() external view returns (uint256) {
        return _adapterSet.length();
    }

    /**
     * @notice Returns the list of supported chains for a given adapter
     * @dev To be used by view accessors that are queried without any gas fees
     * @param _adapter The adapter address
     * @return uint256[] The list of supported chain IDs
     */
    function getSupportedChainsForAdapter(address _adapter) external view returns (uint256[] memory) {
        if (!_adapterSet.contains(_adapter)) revert Registry_NotAdapter();
        IBaseAdapter adapter = IBaseAdapter(_adapter);

        uint256 count = 0;
        for (uint256 i = 0; i < _chainIds.length; i++) {
            if (adapter.isChainIdSupported(_chainIds[i])) {
                count++;
            }
        }

        uint256[] memory listOfChains = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _chainIds.length; i++) {
            if (adapter.isChainIdSupported(_chainIds[i])) {
                listOfChains[index] = _chainIds[i];
                index++;
            }
        }

        return listOfChains;
    }

    /**
     * @notice Returns the list of supported bridges for a given chain ID
     * @dev To be used by view accessors that are queried without any gas fees
     * @param chainId The chain ID to check
     * @return address[] The list of adapter addresses that support the given chain ID
     */
    function getSupportedBridgesForChain(uint256 chainId) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _adapterSet.length(); i++) {
            address adapterAddress = _adapterSet.at(i);
            IBaseAdapter adapter = IBaseAdapter(adapterAddress);
            if (adapter.isChainIdSupported(chainId)) {
                count++;
            }
        }
        address[] memory supportedAdapters = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _adapterSet.length(); i++) {
            address adapterAddress = _adapterSet.at(i);
            IBaseAdapter adapter = IBaseAdapter(adapterAddress);
            if (adapter.isChainIdSupported(chainId)) {
                supportedAdapters[index] = adapterAddress;
                index++;
            }
        }

        return supportedAdapters;
    }

    /**
     * @notice Sets the enabled status for a list of adapters
     * @dev Only the owner can call this function
     * @param adapters The list of adapter addresses
     * @param enabled The list of boolean values indicating the enabled status for each adapter
     */
    function setAdapters(address[] memory adapters, bool[] memory enabled) external onlyOwner {
        if (adapters.length != enabled.length) revert Registry_Invalid_Params();
        for (uint256 i = 0; i < adapters.length; i++) {
            if (enabled[i]) {
                _adapterSet.add(adapters[i]);
            } else {
                _adapterSet.remove(adapters[i]);
            }
            emit AdapterSet(adapters[i], enabled[i]);
        }
    }

    /**
     * @notice Adds a list of chain IDs to the chainIds array
     * @dev We haven't added a way to remove chain IDs because this array is be used from view functions only, aggregating data
     * @dev Only the owner can call this function
     * @param chainIds The list of chain IDs to add
     */
    function addChainIds(uint256[] memory chainIds) external onlyOwner {
        for (uint256 i = 0; i < chainIds.length; i++) {
            _chainIds.push(chainIds[i]);
        }
    }
}
