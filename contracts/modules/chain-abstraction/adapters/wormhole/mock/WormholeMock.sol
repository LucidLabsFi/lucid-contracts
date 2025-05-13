// SPDX-License-Identifier: GPL
pragma solidity 0.8.19;

import {IWormholeRelayer} from "../interfaces/IWormholeRelayer.sol";
import {IWormholeReceiver} from "../interfaces/IWormholeReceiver.sol";

contract WormholeMock is IWormholeRelayer {
    /**
     * @dev A struct holding received requests
     */
    struct receivedMessage {
        address originSender;
        uint16 originDomainId;
        uint16 destination;
        address to;
        bytes callData;
        uint256 gasLimit;
        uint16 refundChain;
        address refundAddress;
    }

    uint256 public counter;
    mapping(uint256 => receivedMessage) public requests;
    // map orign sender (msg.sender) to domain id of the same chain
    mapping(address => uint16) internal _originDomainIds;

    // map orign sender (msg.sender) to domain id of the same chain
    mapping(uint256 => bool) internal _processedRequests;

    constructor() {
        counter = 0;
    }

    function setOriginDomainId(address origin, uint16 domainId) external {
        _originDomainIds[origin] = domainId;
    }

    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress
    ) external payable returns (uint64 sequence) {
        counter++;
        requests[counter] = receivedMessage({
            originSender: msg.sender,
            originDomainId: _originDomainIds[msg.sender],
            destination: targetChain,
            to: targetAddress,
            callData: payload,
            gasLimit: gasLimit,
            refundChain: refundChain,
            refundAddress: refundAddress
        });
        return uint64(counter);
    }

    function callHandle(uint256 id) external {
        require(!_processedRequests[id], "WormholeMock: request already processed");
        receivedMessage memory request = requests[id];
        IWormholeReceiver(request.to).receiveWormholeMessages(
            request.callData,
            new bytes[](0),
            addressToBytes32(request.originSender),
            request.originDomainId,
            keccak256(request.callData)
        );
    }

    function quoteEVMDeliveryPrice(
        uint16 targetChain,
        uint256 receiverValue,
        uint256 gasLimit
    ) external view returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused) {
        return (5e9, 2e9);
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
