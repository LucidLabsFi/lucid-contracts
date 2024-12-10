// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {AggregatorV2V3Interface} from "./interfaces/IOracleAggregatorV2V3.sol";
import {BondBaseOracle, ERC20} from "./bases/BondBaseOracle.sol";
import {FullMath} from "./lib/FullMath.sol";

/// @title Bond Chainlink Oracle
/// @notice Bond Chainlink Oracle Sample Contract
contract BondChainlinkOracle is BondBaseOracle {
    using FullMath for uint256;

    /* ========== ERRORS ========== */
    error BondOracle_BadFeed(address feed_);

    /* ========== STATE VARIABLES ========== */

    /// @dev Parameters to configure price feeds for a pair of tokens. There are 4 cases:
    /// 1. Single feed -> Use when there is a price feed for the exact asset pair in quote
    ///     tokens per payout token (e.g. OHM/ETH which provides the number of ETH (qt) per OHM (pt))
    ///
    ///     Params: numeratorFeed, numeratorUpdateThreshold, 0, 0, decimals, false
    ///
    /// 2. Single feed inverse -> Use when there is a price for the opposite of your asset
    ///     pair in quote tokens per payout token (e.g. OHM/ETH which provides the number
    ///     of ETH per OHM, but you need the number of OHM (qt) per ETH (pt)).
    ///
    ///     Params: numeratorFeed, numeratorUpdateThreshold, 0, 0, decimals, true
    ///
    /// 3. Double feed mul -> Use when two price feeds are required to get the price of the
    ///      desired asset pair in quote tokens per payout token. For example, if you need the
    ///      price of OHM/USD, but there is only a price feed for OHM/ETH and ETH/USD, then
    ///      multiplying the two feeds will give you the price of OHM/USD.
    ///
    ///     Params: numeratorFeed, numeratorUpdateThreshold, denominatorFeed, denominatorUpdateThreshold, decimals, false
    ///
    /// 4. Double feed div -> Use when two price feeds are required to get the price of the
    ///      desired asset pair in quote tokens per payout token. For example, if you need the
    ///      price of OHM/DAI, but there is only a price feed for OHM/ETH and DAI/ETH, then
    ///      dividing the two feeds will give you the price of OHM/DAI.
    ///
    ///     Params: numeratorFeed, numeratorUpdateThreshold, denominatorFeed, denominatorUpdateThreshold, decimals, true
    ///
    struct PriceFeedParams {
        AggregatorV2V3Interface numeratorFeed; // address of the numerator (or first) price feed
        uint48 numeratorUpdateThreshold; // update threshold for the numerator price feed, will revert if data is older than block.timestamp - this
        AggregatorV2V3Interface denominatorFeed; // address of the denominator (or second) price feed. if zero address, then only use numerator feed
        uint48 denominatorUpdateThreshold; // update threshold for the denominator price feed, will revert if data is older than block.timestamp - this
        uint8 decimals; // number of decimals that the price should be scaled to
        bool div; // if true, then the numerator feed is divided by the denominator feed, otherwise multiplied. if only one feed is used, then div = false is standard and div = true is the inverse.
    }

    mapping(ERC20 => mapping(ERC20 => PriceFeedParams)) public priceFeedParams;

    /* ========== CONSTRUCTOR ========== */

    constructor(address aggregator_, address[] memory auctioneers_, address _owner) BondBaseOracle(aggregator_, auctioneers_, _owner) {}

    /* ========== PRICE ========== */

    function _currentPrice(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint256) {
        PriceFeedParams memory params = priceFeedParams[quoteToken_][payoutToken_];

        // Revert if no price feed params are set
        if (address(params.numeratorFeed) == address(0)) revert BondOracle_BadFeed(address(0));

        // Get price from feed
        if (address(params.denominatorFeed) == address(0)) {
            return _getOneFeedPrice(params);
        } else {
            return _getTwoFeedPrice(params);
        }
    }

    function _getOneFeedPrice(PriceFeedParams memory params_) internal view returns (uint256) {
        // Get price from feed
        uint256 price = _validateAndGetPrice(params_.numeratorFeed, params_.numeratorUpdateThreshold);

        // Scale price and return
        return
            params_.div
                ? (10 ** params_.decimals).mulDiv(10 ** (params_.numeratorFeed.decimals()), price)
                : price.mulDiv(10 ** params_.decimals, 10 ** (params_.numeratorFeed.decimals()));
    }

    function _getTwoFeedPrice(PriceFeedParams memory params_) internal view returns (uint256) {
        // Get decimal value scale factor
        uint8 exponent;
        uint8 denomDecimals = params_.denominatorFeed.decimals();
        uint8 numDecimals = params_.numeratorFeed.decimals();
        uint8 paramsDecimals = params_.decimals;

        if (params_.div) {
            if (paramsDecimals + denomDecimals < numDecimals) revert BondOracle_InvalidParams();
            exponent = paramsDecimals + denomDecimals - numDecimals;
        } else {
            if (numDecimals + denomDecimals < paramsDecimals) revert BondOracle_InvalidParams();
            exponent = denomDecimals + numDecimals - paramsDecimals;
        }

        // Get prices from feeds
        uint256 numeratorPrice = _validateAndGetPrice(params_.numeratorFeed, params_.numeratorUpdateThreshold);
        uint256 denominatorPrice = _validateAndGetPrice(params_.denominatorFeed, params_.denominatorUpdateThreshold);

        // Calculate and scale price
        return params_.div ? numeratorPrice.mulDiv(10 ** exponent, denominatorPrice) : numeratorPrice.mulDiv(denominatorPrice, 10 ** exponent);
    }

    function _validateAndGetPrice(AggregatorV2V3Interface feed_, uint48 updateThreshold_) internal view returns (uint256) {
        // Get latest round data from feed
        (uint80 roundId, int256 priceInt, , uint256 updatedAt, uint80 answeredInRound) = feed_.latestRoundData();

        // Validate chainlink price feed data
        // 1. Answer should be greater than zero
        // 2. Updated at timestamp should be within the update threshold
        // 3. Answered in round ID should be the same as the round ID
        if (priceInt <= 0 || updatedAt < block.timestamp - uint256(updateThreshold_) || answeredInRound != roundId)
            revert BondOracle_BadFeed(address(feed_));
        return uint256(priceInt);
    }

    /* ========== DECIMALS ========== */

    function _decimals(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint8) {
        return priceFeedParams[quoteToken_][payoutToken_].decimals;
    }

    /* ========== ADMIN ========== */

    function _setPair(ERC20 quoteToken_, ERC20 payoutToken_, bool supported_, bytes memory oracleData_) internal override {
        if (supported_) {
            // Decode oracle data into PriceFeedParams struct
            PriceFeedParams memory params = abi.decode(oracleData_, (PriceFeedParams));

            // Feed decimals
            uint8 numerDecimals = params.numeratorFeed.decimals();
            uint8 denomDecimals = address(params.denominatorFeed) != address(0) ? params.denominatorFeed.decimals() : 0;

            // Validate params
            if (
                address(params.numeratorFeed) == address(0) ||
                params.numeratorUpdateThreshold < uint48(1 hours) ||
                params.numeratorUpdateThreshold > uint48(7 days) ||
                params.decimals < 6 ||
                params.decimals > 18 ||
                numerDecimals < 6 ||
                numerDecimals > 18 ||
                (address(params.denominatorFeed) == address(0) && !params.div && params.decimals < numerDecimals) ||
                (address(params.denominatorFeed) != address(0) &&
                    (params.denominatorUpdateThreshold < uint48(1 hours) ||
                        params.denominatorUpdateThreshold > uint48(7 days) ||
                        denomDecimals < 6 ||
                        denomDecimals > 18 ||
                        (params.div && params.decimals + denomDecimals < numerDecimals) ||
                        (!params.div && numerDecimals + denomDecimals < params.decimals)))
            ) revert BondOracle_InvalidParams();

            // Store params for token pair
            priceFeedParams[quoteToken_][payoutToken_] = params;
        } else {
            // Delete params for token pair
            delete priceFeedParams[quoteToken_][payoutToken_];
        }
    }
}
