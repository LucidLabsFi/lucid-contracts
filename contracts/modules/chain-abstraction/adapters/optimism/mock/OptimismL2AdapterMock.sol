// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {OptimismL2Adapter} from "../OptimismL2Adapter.sol";
import {IL2ToL2CrossDomainMessenger} from "../interfaces/IL2ToL2CrossDomainMessenger.sol";

import {PredeploysMock} from "./PredeploysMock.sol";
import "hardhat/console.sol";

contract OptimismL2AdapterMock is OptimismL2Adapter {
    // Override the messenger to use the mock predeploys library which contains the mock messenger
    IL2ToL2CrossDomainMessenger internal _mockMessenger = IL2ToL2CrossDomainMessenger(PredeploysMock.L2_TO_L2_CROSS_DOMAIN_MESSENGER);

    constructor(
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint256[] memory chainIds,
        address owner
    ) OptimismL2Adapter(name, minimumGas, treasury, chainIds, owner) {}

    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes memory message
    ) external payable override whenNotPaused returns (bytes32) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        address destAdapter = trustedAdapters[destChainId];

        if (!supportedChainIds[destChainId] || destAdapter == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        bytes memory relayedMessage = abi.encode(BridgedMessage(message, msg.sender, destination));
        _collectAndRefundFees(abi.decode(options, (address)));

        _mockMessenger.sendMessage(destChainId, destAdapter, abi.encodeCall(this.receiveMessage, (relayedMessage)));
    }

    function receiveMessage(bytes calldata _callData) external payable virtual override whenNotPaused {
        uint256 originChainId = _mockMessenger.crossDomainMessageSource();
        if ((msg.sender != address(_mockMessenger)) || (_mockMessenger.crossDomainMessageSender() != trustedAdapters[originChainId]))
            revert Adapter_Unauthorised();

        _registerMessage(_callData, originChainId);
    }
}
