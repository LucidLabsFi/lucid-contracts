// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {XERC20Votes} from "../tokens/ERC20/XERC20Votes.sol";

/// @title XERC20VotesFactory
/// @notice Factory contract to deploy XERC20Votes contracts
contract XERC20VotesFactory {
    /// @notice Event emitted when a new token is deployed
    /// @param token The address of the newly deployed token contract
    /// @param name The name of the token
    /// @param symbol The symbol of the token
    /// @param deployer The address of the deployer
    event TokenDeployed(address indexed token, string indexed name, string symbol, address indexed deployer);

    /// @notice Mapping to keep track of deployed tokens
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new XERC20Votes contract
    /// @param _initialOwner The address of the initial owner of the token
    /// @param name The name of the token
    /// @param symbol The symbol of the token
    /// @param recipients Array of recipient addresses
    /// @param amounts Array of token amounts
    /// @return The address of the deployed contract
    function deployToken(
        address _initialOwner,
        string memory name,
        string memory symbol,
        address[] memory recipients,
        uint256[] memory amounts,
        address _treasury,
        uint256[] memory _bridgeTaxTiers,
        uint256[] memory _bridgeTaxBasisPoints
    ) external returns (address) {
        address token = address(new XERC20Votes(name, symbol, recipients, amounts, _initialOwner, _treasury, _bridgeTaxTiers, _bridgeTaxBasisPoints));
        emit TokenDeployed(token, name, symbol, msg.sender);
        isDeployed[token] = true;
        return token;
    }

    /// @notice Checks if a contract is deployed
    /// @param _contract The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
