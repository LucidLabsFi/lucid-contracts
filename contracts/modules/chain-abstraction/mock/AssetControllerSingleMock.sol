// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AssetControllerSingleMock {
    IERC20 public token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    // mock functions:

    function updateToken(address _token) public {
        token = IERC20(_token);
    }

    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address bridgeAdapter,
        bytes memory bridgeOptions
    ) public payable {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    function resendTransfer(bytes32 transferId, address adapter, bytes memory options) public payable {}

    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) public payable {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    function resendTransfer(bytes32 transferId, address[] memory adapters, uint256[] memory fees, bytes[] memory options) public payable {}
}
