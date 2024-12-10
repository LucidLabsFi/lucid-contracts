// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {ISteerVault} from "./interfaces/ISteerVault.sol";
import {ITWAPOracle} from "./interfaces/ITWAPOracle.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BondBaseOracle, ERC20} from "./bases/BondBaseOracle.sol";

/// @title Bond Steer Pool Oracle
/// @notice Returns the price of the Steer Pool LP token based on TWAPs and the invariant k.
/// @notice Token0 or token1 from Steer should be the payout token. We assume that the lp token has 18 decimals.
contract BondSteerOracle is BondBaseOracle {
    /* ========== ERRORS ========== */
    error BondOracle_BadFeed(address feed_);

    /* ========== STATE VARIABLES ========== */

    ITWAPOracle public twapOracle;

    struct SteerConfig {
        ISteerVault steerVault;
    }

    struct SteerParams {
        ISteerVault steerVault;
        address token0;
        address token1;
        uint8 decimals;
    }

    mapping(ERC20 => mapping(ERC20 => SteerParams)) public priceFeedParams;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address aggregator_,
        address[] memory auctioneers_,
        address _twapOracle,
        address _owner
    ) BondBaseOracle(aggregator_, auctioneers_, _owner) {
        twapOracle = ITWAPOracle(_twapOracle);
    }

    /* ========== PRICE ========== */

    function _currentPrice(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint256) {
        SteerParams memory params = priceFeedParams[quoteToken_][payoutToken_];

        // Revert if no price feed params are set
        if (address(params.token0) == address(0)) revert BondOracle_BadFeed(address(0));

        (uint256 r0, uint256 r1) = params.steerVault.getTotalAmounts();
        uint256 totalSupply = params.steerVault.totalSupply();

        uint256 p0 = twapOracle.getPrice(params.token0, params.token1);
        uint256 p1 = twapOracle.getPrice(params.token1, params.token0);
        return ((Math.sqrt(p0 * p1) * 2 * Math.sqrt(r0 * r1)) / totalSupply);
    }

    /* ========== DECIMALS ========== */

    function _decimals(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint8) {
        SteerParams memory params = priceFeedParams[quoteToken_][payoutToken_];

        return params.decimals;
    }

    /* ========== ADMIN ========== */

    function _setPair(ERC20 quoteToken_, ERC20 payoutToken_, bool supported_, bytes memory oracleData_) internal override {
        if (supported_) {
            // Decode oracle data into SteerConfig struct
            SteerConfig memory params = abi.decode(oracleData_, (SteerConfig));

            // Token addresses
            address token0 = params.steerVault.token0();
            address token1 = params.steerVault.token1();

            uint8 decimals = params.steerVault.decimals();

            // Validate params
            if (token0 == address(0) || token1 == address(0) || decimals < 6 || decimals > 18) revert BondOracle_InvalidParams();

            // Store params for token pair
            priceFeedParams[quoteToken_][payoutToken_] = SteerParams({
                steerVault: params.steerVault,
                token0: token0,
                token1: token1,
                decimals: decimals
            });
        } else {
            // Delete params for token pair
            delete priceFeedParams[quoteToken_][payoutToken_];
        }
    }
}
