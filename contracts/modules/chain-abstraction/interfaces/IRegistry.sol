// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IRegistry {
    /**
     * @notice Checks if an address is a local adapter
     * @param adapter The address to check
     * @return bool True if the address is a local adapter, false otherwise
     */
    function isLocalAdapter(address adapter) external view returns (bool);
}
