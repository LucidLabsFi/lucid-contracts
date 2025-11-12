// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IRelayDepository} from "../interfaces/IRelayDepository.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RelayDepositoryMock is IRelayDepository {
    /// @notice Emit event when a native deposit is made
    event RelayNativeDeposit(address from, uint256 amount, bytes32 id);

    /// @notice Emit event when an erc20 deposit is made
    event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id);

    mapping(bytes32 => bool) public override callRequests;

    constructor() {}

    function depositNative(address depositor, bytes32 id) external payable override {
        require(msg.value > 0);
        emit RelayNativeDeposit(depositor == address(0) ? msg.sender : depositor, msg.value, id);
    }

    function depositErc20(address depositor, address token, uint256 amount, bytes32 id) external override {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit RelayErc20Deposit(depositor == address(0) ? msg.sender : depositor, token, amount, id);
    }
}
