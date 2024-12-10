// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {QuadraticVoteStrategy} from "../../modules/governor/strategies/QuadraticVoteStrategy.sol";

/// @title QuadraticVoteStrategyFactory
/// @notice Factory contract to deploy QuadraticVoteStrategy contracts
contract QuadraticVoteStrategyFactory {
    /// @notice Event emitted when a new strategy is deployed
    /// @param strategy The strategy contract address
    /// @param token The token address
    /// @param deployer The address of the deployer
    event StrategyDeployed(address strategy, address token, address deployer);

    /// @notice Mapping to keep track of deployed strategies
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new QuadraticVoteStrategyFactory contract
    /// @param token The address of the token used in the strategy
    /// @return The address of the deployed strategy
    function deployStrategy(address token, address governor, uint256 threshold, uint256 decimals) external returns (address) {
        address strategy = address(new QuadraticVoteStrategy(token, governor, threshold, decimals));
        emit StrategyDeployed(strategy, token, msg.sender);
        isDeployed[strategy] = true;
        return strategy;
    }

    /// @notice Checks if a contract is deployed
    /// @param _contract The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
