// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IRelayApprovalProxyV3 {
    struct Call3Value {
        address target;
        bool allowFailure;
        uint256 value;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function transferAndMulticall(
        address[] calldata tokens,
        uint256[] calldata amounts,
        Call3Value[] calldata calls,
        address refundTo,
        address nftRecipient,
        bytes calldata metadata
    ) external payable returns (Result[] memory returnData);
}
