// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IL2ToL2CrossDomainMessenger} from "../interfaces/IL2ToL2CrossDomainMessenger.sol";

contract L2ToL2CrossDomainMessengerMock is IL2ToL2CrossDomainMessenger {
    struct relayedMessage {
        bytes message;
        address recipient;
        uint256 destination;
        address originSender;
        uint256 originChain;
    }

    mapping(uint256 => relayedMessage) public receivedMessages;
    mapping(uint256 => uint256) public chainIdMappings; // map from -> to chain id

    address private messageSender;
    uint256 private messageSource;

    uint256 public nonce;

    constructor(uint256[] memory _chainIds1, uint256[] memory _chainIds2) {
        for (uint256 i = 0; i < _chainIds1.length; i++) {
            chainIdMappings[_chainIds1[i]] = _chainIds2[i];
        }
    }

    function crossDomainMessageSender() external view override returns (address) {
        return messageSender;
    }

    function crossDomainMessageSource() external view override returns (uint256) {
        return messageSource;
    }

    function _setCrossDomainMessageSender(address _messageSender) public {
        messageSender = _messageSender;
    }

    function _setCrossDomainMessageSource(uint256 _messageSource) public {
        messageSource = _messageSource;
    }

    function _setChainIdMapping(uint256 _from, uint256 _to) public {
        chainIdMappings[_from] = _to;
    }

    function sendMessage(uint256 _destination, address _target, bytes calldata _message) external payable {
        nonce++;
        receivedMessages[nonce] = relayedMessage(_message, _target, _destination, msg.sender, chainIdMappings[_destination]);
    }

    function processMessage(uint256 _nonce) external {
        relayedMessage memory message = receivedMessages[_nonce];
        // Call `receiveMessage` on the destination contract
        (bool success, ) = message.recipient.call(message.message);
        require(success, "Message processing failed");

        // Clear the message after processing to prevent re-entry
        delete receivedMessages[_nonce];
    }

    function processMessageAndSetCDM(uint256 _nonce) external {
        relayedMessage memory message = receivedMessages[_nonce];

        _setCrossDomainMessageSender(message.originSender);
        _setCrossDomainMessageSource(message.originChain);

        // Call `receiveMessage` on the destination contract
        (bool success, ) = message.recipient.call(message.message);
        require(success, "Message processing failed");

        // Clear the message after processing to prevent re-entry
        delete receivedMessages[_nonce];
    }

    function relayMessage(
        uint256 _destination,
        uint256 _source,
        uint256 _nonce,
        address _sender,
        address _target,
        bytes calldata _message
    ) external payable {}
}
