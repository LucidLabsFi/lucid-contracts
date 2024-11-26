// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

interface IHyperlaneAdapter {
    function handle(uint32 _origin, bytes32 _sender, bytes calldata _message) external payable;
}
