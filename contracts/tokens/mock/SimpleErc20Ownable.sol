// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SimpleTokenOwnable is ERC20, Ownable {
    uint8 private _decimals;

    constructor(uint8 decimals_) ERC20("Token", "TKN") {
        _decimals = decimals_;
        _mint(msg.sender, 10000000 * 10 ** decimals());
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function burn(address user, uint256 amount) public {
        if (msg.sender != user) {
            _spendAllowance(user, msg.sender, amount);
        }
        _burn(user, amount);
    }
}
