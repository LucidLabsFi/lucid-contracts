// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {IXReceive} from "./interfaces/IXReceive.sol";

contract ConnextMock {
    /**
     * @dev A struct holding received requests
     */
    struct xCallData {
        address originSender;
        uint32 originDomainId;
        uint32 destination;
        address to;
        address asset;
        address delegate;
        uint256 amount;
        uint256 slippage;
        bytes callData;
    }

    uint256 public counter;
    mapping(uint256 => xCallData) public requests;
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

    function xcall(
        uint32 destination,
        address to,
        address asset,
        address delegate,
        uint256 amount,
        uint256 slippage,
        bytes memory _calldata
    ) external payable returns (bytes32) {
        counter++;
        requests[counter] = xCallData({
            originSender: msg.sender,
            originDomainId: _originDomainIds[msg.sender],
            destination: destination,
            to: to,
            asset: asset,
            delegate: delegate,
            amount: amount,
            slippage: slippage,
            callData: _calldata
        });
        return bytes32(counter);
    }

    function callXReceive(uint256 id) external {
        require(!_processedRequests[id], "ConnextMock: request already processed");
        xCallData memory request = requests[id];
        IXReceive(request.to).xReceive(bytes32(id), request.amount, request.asset, request.originSender, request.originDomainId, request.callData);
    }
}
