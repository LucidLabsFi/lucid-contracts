// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract USDCMock is ERC20, AccessControl {
    bytes32 public constant MINT_ROLE = keccak256("MINT_ROLE");

    uint8 private _decimals;

    constructor(string memory name, string memory symbol, address admin) ERC20(name, symbol) {
        // Grant the contract deployer the default admin role
        _setupRole(DEFAULT_ADMIN_ROLE, admin);

        _decimals = 6;

        // Grant the contract deployer the minting role
        _setupRole(MINT_ROLE, admin);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    // Mint function secured by the MINT_ROLE
    function mint(address to, uint256 amount) external onlyRole(MINT_ROLE) {
        _mint(to, amount);
    }

    function burn(uint256 amount) external onlyRole(MINT_ROLE) {
        _burn(msg.sender, amount);
    }
}
