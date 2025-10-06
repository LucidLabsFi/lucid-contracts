// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19 <=0.8.20;

interface IAssetController {
    function token() external view returns (address);

    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address bridgeAdapter,
        bytes memory bridgeOptions
    ) external payable;

    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) external payable;

    function resendTransfer(bytes32 transferId, address adapter, bytes memory options) external payable;

    function resendTransfer(bytes32 transferId, address[] memory adapters, uint256[] memory fees, bytes[] memory options) external payable;
}
