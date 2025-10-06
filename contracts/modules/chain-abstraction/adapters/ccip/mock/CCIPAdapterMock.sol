// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {CCIPAdapter} from "../CCIPAdapter.sol";

contract CCIPAdapterMock is CCIPAdapter {
    constructor(
        address _bridgeRouter,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        uint256[] memory chainIds,
        uint64[] memory domainIds,
        address owner
    ) CCIPAdapter(_bridgeRouter, name, minimumGas, treasury, fee, chainIds, domainIds, owner) {}

    // Exposes the internal _collectAndRefundFees function for testing purposes, since MockRouter returns 0 fee
    function collectAndRefundFees(uint256 quotedFee, address refundAddress) external payable {
        _collectAndRefundFees(quotedFee, refundAddress);
    }
}
