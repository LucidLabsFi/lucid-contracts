// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IAxelarGateway} from "../interfaces/IAxelarGateway.sol";
import {IAxelarExecutable} from "../interfaces/IAxelarExecutable.sol";

/// @notice Updated to pass commandId in _execute()
contract AxelarExecutable is IAxelarExecutable {
    IAxelarGateway public immutable gateway;

    constructor(address gateway_) {
        if (gateway_ == address(0)) revert InvalidAddress();

        gateway = IAxelarGateway(gateway_);
    }

    function execute(bytes32 commandId, string calldata sourceChain, string calldata sourceAddress, bytes calldata payload) external {
        bytes32 payloadHash = keccak256(payload);

        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, payloadHash)) revert NotApprovedByGateway();

        _execute(commandId, sourceChain, sourceAddress, payload);
    }

    function _execute(bytes32 commandId, string calldata sourceChain, string calldata sourceAddress, bytes calldata payload) internal virtual {}
}
