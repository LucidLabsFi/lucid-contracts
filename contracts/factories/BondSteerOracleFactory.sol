// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {BondALMOracle} from "../modules/bonding/BondALMOracle.sol";

/// @title BondALMOracleFactory
/// @notice Factory contract to deploy BondALMOracle contracts
contract BondALMOracleFactory {
    /// @notice Event emitted when a new oracle is deployed
    /// @param oracle The address of the newly deployed oracle contract
    /// @param caller The address of the deployer
    event OracleDeployed(address indexed oracle, address indexed caller);

    /// @notice Mapping to keep track of deployed oracles
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new BondALMOracle contract
    /// @param aggregator The address of the BondingEngine aggregator
    /// @param auctioneers Array of auctioneer addresses
    /// @param twapOracle The address of the TWAP oracle contract
    /// @param owner The address of the owner of the Oracle contract
    /// @return The address of the deployed contract
    function deployOracle(address aggregator, address[] memory auctioneers, address twapOracle, address owner) external returns (address) {
        address oracle = address(new BondALMOracle(aggregator, auctioneers, twapOracle, owner));
        emit OracleDeployed(oracle, msg.sender);
        isDeployed[oracle] = true;
        return oracle;
    }

    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
