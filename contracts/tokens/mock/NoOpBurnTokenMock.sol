// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract NoOpBurnTokenMock is ERC20 {
    constructor() ERC20("No Op Burn Token", "NOB") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256) external pure returns (bool) {
        return false;
    }
}
