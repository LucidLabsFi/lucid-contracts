// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract MintableToken is ERC20, AccessControl {
    bytes32 public constant MINT_ROLE = keccak256("MINT_ROLE");

    constructor(string memory name, string memory symbol, address admin) ERC20(name, symbol) {
        // Grant the contract deployer the default admin role
        _setupRole(DEFAULT_ADMIN_ROLE, admin);

        // Grant the contract deployer the minting role
        _setupRole(MINT_ROLE, admin);
    }

    // Mint function secured by the MINT_ROLE
    function mint(address to, uint256 amount) external onlyRole(MINT_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
