// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {OneTokenOneVoteStrategy} from "../../modules/governor/strategies/OneTokenOneVoteStrategy.sol";

/// @title OneTokenOneVoteStrategyFactory
/// @notice Factory contract to deploy OneTokenOneVoteStrategy contracts
contract OneTokenOneVoteStrategyFactory {
    /// @notice Event emitted when a new strategy is deployed
    /// @param strategy The strategy contract address
    /// @param token The token address
    /// @param deployer The address of the deployer
    event StrategyDeployed(address strategy, address token, address deployer);

    /// @notice Mapping to keep track of deployed strategies
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new OneTokenOneVoteStrategy contract
    /// @param token The address of the token used in the strategy
    /// @return The address of the deployed strategy
    function deployStrategy(address token, address governor) external returns (address) {
        address strategy = address(new OneTokenOneVoteStrategy(token, governor));
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
