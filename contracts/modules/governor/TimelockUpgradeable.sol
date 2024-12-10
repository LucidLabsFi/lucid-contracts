// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

contract TimelockUpgradeable is Initializable, TimelockControllerUpgradeable {
    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // Voting delay and voting period is calculated in blocks, not seconds. You need to account for the avg block time of your chain.
    function initialize(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin) public initializer {
        __TimelockController_init(minDelay, proposers, executors, admin);
    }
}
