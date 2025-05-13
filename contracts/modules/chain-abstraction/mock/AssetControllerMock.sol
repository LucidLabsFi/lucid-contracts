// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {AssetController} from "../AssetController.sol";

contract AssetControllerMock is AssetController {
    constructor(
        address[5] memory _addresses, //token, initialOwner, pauser, feeCollector, controllerAddress
        uint256 _duration,
        uint256 _minBridges,
        address[] memory _multiBridgeAdapters,
        uint256[] memory _chainId,
        address[] memory _bridges,
        uint256[] memory _mintingLimits,
        uint256[] memory _burningLimits,
        bytes4[2] memory _selectors
    ) AssetController(_addresses, _duration, _minBridges, _multiBridgeAdapters, _chainId, _bridges, _mintingLimits, _burningLimits, _selectors) {}

    // mock functions:

    function updateToken(address _token) public {
        token = _token;
    }
}
