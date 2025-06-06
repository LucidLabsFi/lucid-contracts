// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

interface IXReceive {
    function xReceive(
        bytes32 _transferId,
        uint256 _amount,
        address _asset,
        address _originSender,
        uint32 _origin,
        bytes memory _callData
    ) external returns (bytes memory);
}
