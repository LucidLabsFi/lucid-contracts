// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {BondChainlinkOracle} from "../modules/bonding/BondChainlinkOracle.sol";
import {BondChainlinkOracleL2} from "../modules/bonding/BondChainlinkOracleL2.sol";

/// @title BondChainlinkOracleFactory
/// @notice Factory contract to deploy BondChainlinkOracle contracts
contract BondChainlinkOracleFactory {
    /// @notice Event emitted when a new oracle is deployed
    /// @param oracle The address of the newly deployed oracle contract
    /// @param caller The address of the deployer
    event OracleDeployed(address oracle, address caller);

    /// @notice Mapping to keep track of deployed oracles
    mapping(address => bool) public isDeployed;

    /// @notice Deploys a new BondChainlinkOracle contract
    /// @param aggregator The address of the BondingEngine aggregator
    /// @param auctioneers Array of auctioneer addresses
    /// @param owner The address of the owner of the Oracle contract
    function deployOracle(address aggregator, address[] memory auctioneers, address owner) external returns (address) {
        address oracle = address(new BondChainlinkOracle(aggregator, auctioneers, owner));
        emit OracleDeployed(oracle, msg.sender);
        isDeployed[oracle] = true;
        return oracle;
    }

    /// @notice Deploys a new BondChainlinkOracleL2 contract, to be used in L2s for sequencer uptime checks
    /// @param aggregator The address of the BondingEngine aggregator
    /// @param auctioneers Array of auctioneer addresses
    /// @param sequencerUptimeFeed The address of the sequencer uptime feed
    /// @param owner The address of the owner of the Oracle contract
    function deployOracleL2(address aggregator, address[] memory auctioneers, address sequencerUptimeFeed, address owner) external returns (address) {
        address oracle = address(new BondChainlinkOracleL2(aggregator, auctioneers, sequencerUptimeFeed, owner));
        emit OracleDeployed(oracle, msg.sender);
        isDeployed[oracle] = true;
        return oracle;
    }

    /// @notice Checks if a contract is deployed
    /// @param _contract The address of the contract
    /// @return True if the contract is deployed, false otherwise
    function isContractDeployed(address _contract) external view returns (bool) {
        return isDeployed[_contract];
    }
}
