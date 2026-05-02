// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRelayApprovalProxyV3} from "../interfaces/IRelayApprovalProxyV3.sol";

contract RelayApprovalProxyV3Mock is IRelayApprovalProxyV3 {
    using SafeERC20 for IERC20;

    error ArrayLengthsMismatch();
    error RefundToCannotBeZeroAddress();

    event TransferAndMulticallCalled(
        address indexed caller,
        address[] tokens,
        uint256[] amounts,
        address indexed refundTo,
        address indexed nftRecipient,
        bytes metadata,
        uint256 value
    );

    function transferAndMulticall(
        address[] calldata tokens,
        uint256[] calldata amounts,
        Call3Value[] calldata,
        address refundTo,
        address nftRecipient,
        bytes calldata metadata
    ) external payable override returns (Result[] memory returnData) {
        if (tokens.length != amounts.length) revert ArrayLengthsMismatch();
        if (refundTo == address(0)) revert RefundToCannotBeZeroAddress();

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
        }

        emit TransferAndMulticallCalled(msg.sender, tokens, amounts, refundTo, nftRecipient, metadata, msg.value);
        returnData = new Result[](0);
    }
}
