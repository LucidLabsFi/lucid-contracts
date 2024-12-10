// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {AggregatorV3Interface} from "./interfaces/IOracleAggregatorV2V3.sol";
import {BondBaseOracle, ERC20} from "./bases/BondBaseOracle.sol";
import {FullMath} from "./lib/FullMath.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {OracleLibrary} from "./lib/OracleLibrary.sol";

/// @title Bond Uniswap V3 Oracle for L2s
/// @notice Bond Uniswap V3 Oracle Sample Contract
contract BondUniV3OracleL2 is BondBaseOracle {
    using FullMath for uint256;

    /* ========== ERRORS ========== */
    error BondOracle_InvalidTick();
    error BondOracle_SequencerDown();

    /* ========== STATE VARIABLES ========== */

    AggregatorV3Interface public immutable sequencerUptimeFeed;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;

    struct UniswapV3Params {
        IUniswapV3Pool numeratorPool; // address of the numerator (or first) pool
        IUniswapV3Pool denominatorPool; // address of the denominator (or second) pool. if zero address, then only use numerator feed
        uint32 observationWindowSeconds; // length of time to calculate the average price over (TWAP window)
        uint8 decimals; // number of decimals that the price should be scaled to
    }

    mapping(ERC20 => mapping(ERC20 => UniswapV3Params)) public uniswapV3Params;

    /* ========== CONSTRUCTOR ========== */

    /// @notice Sequencer Uptime Feeds can be taken from https://docs.chain.link/data-feeds/l2-sequencer-feeds.
    /// @dev Uniswap V3 is deployed in Arbitrum, OP, Base,
    constructor(
        address aggregator_,
        address[] memory auctioneers_,
        address sequencerUptimeFeed_,
        address _owner
    ) BondBaseOracle(aggregator_, auctioneers_, _owner) {
        sequencerUptimeFeed = AggregatorV3Interface(sequencerUptimeFeed_);
    }

    /* ========== PRICE ========== */

    function _currentPrice(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint256) {
        UniswapV3Params memory params = uniswapV3Params[quoteToken_][payoutToken_];

        // Revert if no pools are set
        if (address(params.numeratorPool) == address(0)) revert BondOracle_InvalidParams();

        // Validate sequencer is up
        _validateSequencerUp();

        // Get price from feed
        if (address(params.denominatorPool) == address(0)) {
            // One pool price as quote tokens per payout token scaled to params.decimals
            // The pool must be for the quote token and payout token. This is checked when the params are set
            return _validateAndGetPrice(address(payoutToken_), params.numeratorPool, params.observationWindowSeconds, params.decimals);
        } else {
            // Two pool price
            // Numerator pool should return price of payout token
            // Denominator pool should return price of quote token
            // Both pools should have the same intermediate asset
            // This is checked when the params are set

            uint256 numerator = _validateAndGetPrice(address(payoutToken_), params.numeratorPool, params.observationWindowSeconds, params.decimals);

            uint256 denominator = _validateAndGetPrice(
                address(quoteToken_),
                params.denominatorPool,
                params.observationWindowSeconds,
                params.decimals
            );

            return numerator.mulDiv(10 ** params.decimals, denominator);
        }
    }

    function _validateAndGetPrice(
        address token_,
        IUniswapV3Pool pool_,
        uint32 observationWindowSeconds_,
        uint8 decimals_
    ) internal view returns (uint256) {
        // Pool, tokens, and configuration validated when pools params are set

        // Get tick from pool
        (int24 timeWeightedTick, ) = OracleLibrary.consult(address(pool_), observationWindowSeconds_);

        // Convert the tick to a price in terms of the other token
        (address token0, address token1) = (pool_.token0(), pool_.token1());
        address quoteToken = token0 == token_ ? token1 : token0;

        // Decimals: quoteTokenDecimals
        uint256 tokenPrice = OracleLibrary.getQuoteAtTick(int24(timeWeightedTick), uint128(10 ** ERC20(token_).decimals()), token_, quoteToken);

        // Scale price and return
        return tokenPrice.mulDiv(10 ** decimals_, 10 ** ERC20(quoteToken).decimals());
    }

    function _validateSequencerUp() internal view {
        // Get latest round data from sequencer uptime feed
        (, int256 status, uint256 startedAt, , ) = sequencerUptimeFeed.latestRoundData();
        // Validate sequencer uptime feed data
        // 1. Status should be 0 (up). If 1, then it's down
        // 2. Current timestamp should be past catch-up grace period after a restart
        if (status == 1 || block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) revert BondOracle_SequencerDown();
    }

    /* ========== DECIMALS ========== */

    function _decimals(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint8) {
        return uniswapV3Params[quoteToken_][payoutToken_].decimals;
    }

    /* ========== ADMIN ========== */

    function _setPair(ERC20 quoteToken_, ERC20 payoutToken_, bool supported_, bytes memory oracleData_) internal override {
        if (supported_) {
            // Decode oracle data into PriceFeedParams struct
            UniswapV3Params memory params = abi.decode(oracleData_, (UniswapV3Params));

            // Token decimals
            uint8 quoteDecimals = quoteToken_.decimals();
            uint8 payoutDecimals = payoutToken_.decimals();

            // Validate params
            // Case 1: Numerator pool only
            // Case 2: Two pool

            // Validate general params
            if (
                address(params.numeratorPool) == address(0) ||
                params.decimals < 6 ||
                params.decimals > 18 ||
                quoteDecimals < 6 ||
                quoteDecimals > 18 ||
                payoutDecimals < 6 ||
                payoutDecimals > 18 ||
                params.observationWindowSeconds < 19 ||
                params.decimals + payoutDecimals < quoteDecimals
            ) revert BondOracle_InvalidParams();

            // Check that the numerator pool is a contract
            if (address(params.numeratorPool).code.length == 0) revert BondOracle_InvalidParams();

            // Check that the observationWindowSeconds is less than or equal to the max on the numerator pool
            {
                uint32 oldestSecondsAgo = OracleLibrary.getOldestObservationSecondsAgo(address(params.numeratorPool));
                if (params.observationWindowSeconds > oldestSecondsAgo) revert BondOracle_InvalidParams();
            }

            // Confirm that the pools are valid
            if (address(params.denominatorPool) == address(0)) {
                // Case 1: Numerator pool only, denominator pool is 0 address

                // Pool tokens must be quote token and payout token
                address token0 = params.numeratorPool.token0();
                address token1 = params.numeratorPool.token1();
                if (
                    (token0 != address(quoteToken_) && token1 != address(quoteToken_)) ||
                    (token0 != address(payoutToken_) && token1 != address(payoutToken_))
                ) revert BondOracle_InvalidParams();
            } else {
                // Case 2: Two pool price

                // Check that the numerator pool is a contract
                if (address(params.denominatorPool).code.length == 0) revert BondOracle_InvalidParams();

                // Check that the observationWindowSeconds is less than or equal to the max on the numerator pool
                {
                    uint32 oldestSecondsAgo = OracleLibrary.getOldestObservationSecondsAgo(address(params.denominatorPool));
                    if (params.observationWindowSeconds > oldestSecondsAgo) revert BondOracle_InvalidParams();
                }

                // Pools must have the same intermediate token
                // Payout token must be in numerator pool
                // Quote token must be in denominator pool
                address numToken0 = params.numeratorPool.token0();
                address numToken1 = params.numeratorPool.token1();
                address denomToken0 = params.denominatorPool.token0();
                address denomToken1 = params.denominatorPool.token1();
                if (
                    (numToken0 != address(payoutToken_) && numToken1 != address(payoutToken_)) ||
                    (denomToken0 != address(quoteToken_) && denomToken1 != address(quoteToken_))
                ) revert BondOracle_InvalidParams();

                // We know that the tokens are in the right pools now check that the intermediate token is the same
                address numInterToken = numToken0 == address(payoutToken_) ? numToken1 : numToken0;
                address denomInterToken = denomToken0 == address(quoteToken_) ? denomToken1 : denomToken0;

                if (numInterToken != denomInterToken) revert BondOracle_InvalidParams();
            }

            // Store params for token pair
            uniswapV3Params[quoteToken_][payoutToken_] = params;
        } else {
            // Delete params for token pair
            delete uniswapV3Params[quoteToken_][payoutToken_];
        }
    }
}
