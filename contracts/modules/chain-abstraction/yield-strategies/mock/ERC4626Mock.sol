// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title ERC4626Mock
 * @notice ERC4626 mock based on OpenZeppelin's implementation
 */
contract ERC4626Mock is ERC4626 {
    bool public badDepositReturn;

    constructor(address asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC4626(IERC20Metadata(asset_)) {}

    function setBadDepositReturn(bool enabled) external {
        badDepositReturn = enabled;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        shares = super.deposit(assets, receiver);
        if (badDepositReturn && shares > 0) {
            return shares - 1;
        }
        return shares;
    }
}
