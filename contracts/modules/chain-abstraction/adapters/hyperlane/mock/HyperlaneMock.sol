// SPDX-License-Identifier: GPL
pragma solidity 0.8.19;

import {IMailbox} from "../interfaces/IMailbox.sol";
import {IHyperlaneAdapter} from "../interfaces/IHyperlaneAdapter.sol";

contract HyperlaneMock is IMailbox {
    /**
     * @dev A struct holding received requests
     */
    struct receivedMessage {
        address originSender;
        uint32 originDomainId;
        uint32 destination;
        bytes32 to;
        bytes callData;
    }

    uint256 public counter;
    mapping(uint256 => receivedMessage) public requests;
    // map orign sender (msg.sender) to domain id of the same chain
    mapping(address => uint32) internal _originDomainIds;

    // map orign sender (msg.sender) to domain id of the same chain
    mapping(uint256 => bool) internal _processedRequests;

    constructor() {
        counter = 0;
    }

    function setOriginDomainId(address origin, uint32 domainId) external {
        _originDomainIds[origin] = domainId;
    }

    function dispatch(
        uint32 destination,
        bytes32 recipientAddress,
        bytes memory _calldata,
        bytes memory _metadata
    ) external payable returns (bytes32) {
        counter++;
        requests[counter] = receivedMessage({
            originSender: msg.sender,
            originDomainId: _originDomainIds[msg.sender],
            destination: destination,
            to: recipientAddress,
            callData: _calldata
        });
        return bytes32(counter);
    }

    function callHandle(uint256 id) external {
        require(!_processedRequests[id], "HyperlaneMock: request already processed");
        receivedMessage memory request = requests[id];
        address destination = bytes32ToAddress(request.to);
        IHyperlaneAdapter(destination).handle(request.originDomainId, addressToBytes32(request.originSender), request.callData);
    }

    function quoteDispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody,
        bytes memory _metadata
    ) external view returns (uint256 fee) {
        // return 5 gwei
        return 5e9;
    }

    /// @dev Converts an address to bytes32.
    /// @param _addr The address to be converted to bytes32.
    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }

    /// @dev Converts bytes32 to address.
    /// @param _bytes The bytes32 to be converted to address.
    function bytes32ToAddress(bytes32 _bytes) internal pure returns (address) {
        return address(uint160(uint256(_bytes)));
    }
}
