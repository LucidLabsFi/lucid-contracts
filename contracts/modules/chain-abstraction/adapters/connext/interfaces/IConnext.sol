// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

interface IConnext {
    struct TransferInfo {
        uint32 originDomain;
        uint32 destinationDomain;
        uint32 canonicalDomain;
        address to;
        address delegate;
        bool receiveLocal;
        bytes callData;
        uint256 slippage;
        address originSender;
        uint256 bridgedAmt;
        uint256 normalizedIn;
        uint256 nonce;
        bytes32 canonicalId;
    }

    function xReceive(
        bytes32 _transferId,
        uint256 _amount,
        address _asset,
        address _originSender,
        uint32 _origin,
        bytes calldata _callData
    ) external returns (bytes memory);

    function xcall(
        uint32 _destination,
        address _to,
        address _asset,
        address _delegate,
        uint256 _amount,
        uint256 _slippage,
        bytes calldata _callData
    ) external payable returns (bytes32);

    function forceUpdateSlippage(TransferInfo calldata _params, uint256 _slippage) external;
}
