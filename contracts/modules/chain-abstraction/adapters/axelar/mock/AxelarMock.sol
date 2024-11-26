// SPDX-License-Identifier: GPL
pragma solidity 0.8.19;

import {IAxelarGateway} from "../interfaces/IAxelarGateway.sol";
import {IAxelarExecutable} from "../interfaces/IAxelarExecutable.sol";
import {IAxelarGasService} from "../interfaces/IAxelarGasService.sol";
import {StringToAddress, AddressToString} from "../libs/AddressStrings.sol";

/// @notice Also serves as a mock for GasService
contract AxelarMock is IAxelarGasService {
    /**
     * @dev A struct holding received requests
     */
    struct receivedMessage {
        address originSender;
        string originDomainId;
        string destination;
        string to;
        bytes callData;
    }

    uint256 public counter;
    mapping(uint256 => receivedMessage) public requests;
    // map orign sender (msg.sender) to domain id of the same chain
    mapping(address => string) internal _originDomainIds;

    // map orign sender (msg.sender) to domain id of the same chain
    mapping(uint256 => bool) internal _processedRequests;

    constructor() {
        counter = 0;
    }

    function setOriginDomainId(address origin, string memory domainId) external {
        _originDomainIds[origin] = domainId;
    }

    function callContract(string calldata destinationChain, string calldata contractAddress, bytes calldata payload) external {
        counter++;
        requests[counter] = receivedMessage({
            originSender: msg.sender,
            originDomainId: _originDomainIds[msg.sender],
            destination: destinationChain,
            to: contractAddress,
            callData: payload
        });
    }

    function callHandle(uint256 id) external {
        require(!_processedRequests[id], "AxelarMock: request already processed");
        receivedMessage memory request = requests[id];
        address destination = StringToAddress.toAddress(request.to);
        IAxelarExecutable(destination).execute(bytes32(id), request.originDomainId, AddressToString.toString(request.originSender), request.callData);
    }

    function validateContractCall(
        bytes32 commandId,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes32 payloadHash
    ) external returns (bool) {
        return true;
    }

    // Axelar Gas Service
    function payNativeGasForContractCall(
        address sender,
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        address refundAddress
    ) external payable override {
        // Do nothing
    }
}
