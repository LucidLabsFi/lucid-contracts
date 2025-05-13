// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ICrossL2ProverV2} from "../interfaces/ICrossL2ProverV2.sol";

contract CrossL2ProverV2Mock is ICrossL2ProverV2 {
    struct EventData {
        uint32 chainId;
        address emittingContract;
        bytes topics;
        bytes unindexedData;
    }
    mapping(bytes32 => EventData) public eventChainId;

    function validateEvent(
        bytes calldata proof
    ) external view returns (uint32 chainId, address emittingContract, bytes memory topics, bytes memory unindexedData) {
        EventData memory eventData = eventChainId[keccak256(proof)];
        // if eventData is empty, revert
        if (eventData.chainId == 0) revert();
        return (eventData.chainId, eventData.emittingContract, eventData.topics, abi.encode(eventData.unindexedData));
    }

    function setEvent(bytes calldata proof, uint32 chainId, address emittingContract, bytes calldata topics, bytes calldata unindexedData) external {
        bytes32 proofHash = keccak256(proof);
        eventChainId[proofHash] = EventData(chainId, emittingContract, topics, unindexedData);
    }

    // Not implemented
    function inspectLogIdentifier(
        bytes calldata proof
    ) external pure returns (uint32 srcChain, uint64 blockNumber, uint16 receiptIndex, uint8 logIndex) {
        return (0, 0, 0, 0);
    }

    function inspectPolymerState(bytes calldata proof) external pure returns (bytes32 stateRoot, uint64 height, bytes memory signature) {
        return (bytes32(0), 0, bytes(""));
    }
}
