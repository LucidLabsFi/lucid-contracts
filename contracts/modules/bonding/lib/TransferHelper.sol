// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.15;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @notice Safe ERC20 and ETH transfer library that safely handles missing return values.
/// @author Modified from Uniswap (https://github.com/Uniswap/uniswap-v3-periphery/blob/main/contracts/libraries/TransferHelper.sol)
/// @author Taken from Solmate.
library TransferHelper {
    function safeTransferFrom(ERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(ERC20.transferFrom.selector, from, to, amount));

        require(success && (data.length == 0 || abi.decode(data, (bool))) && address(token).code.length > 0, "TRANSFER_FROM_FAILED");
    }

    function safeTransfer(ERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(ERC20.transfer.selector, to, amount));

        require(success && (data.length == 0 || abi.decode(data, (bool))) && address(token).code.length > 0, "TRANSFER_FAILED");
    }

    function safeApprove(ERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(ERC20.approve.selector, to, amount));

        require(success && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }

    // function safeTransferETH(address to, uint256 amount) internal {
    //     (bool success, ) = to.call{value: amount}(new bytes(0));

    //     require(success, "ETH_TRANSFER_FAILED");
    // }
}
