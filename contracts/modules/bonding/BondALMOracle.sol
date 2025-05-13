// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {IALMVault} from "./interfaces/IALMVault.sol";
import {ITWAPOracle} from "./interfaces/ITWAPOracle.sol";
import {BondBaseOracle, ERC20} from "./bases/BondBaseOracle.sol";

/// @title Bond ALM Oracle
/// @notice Returns the price of an ALM Pool LP token in the Bond market's payout token based on TWAPs of the underlying assets.
/// @notice The Quote token of the Bond market should be the address of the ALM LP token.
contract BondALMOracle is BondBaseOracle {
    /* ========== ERRORS ========== */

    /// @notice Thrown when the price feed params are invalid
    error BondOracle_BadFeed(address feed_);

    /* ========== STATE VARIABLES ========== */

    /// @notice TWAP oracle to get the price of the underlying assets
    ITWAPOracle public twapOracle;

    struct ALMConfig {
        IALMVault almVault;
    }

    struct ALMParams {
        IALMVault almVault;
        address token0;
        uint8 token0Decimals;
        address token1;
        uint8 token1Decimals;
        uint8 decimals;
    }

    /// @notice Mapping the quote token (ALM LP) to the payout token of the bond to the price feed params
    mapping(ERC20 => mapping(ERC20 => ALMParams)) public priceFeedParams;

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

    /// @notice Returns the price of the ALM LP token in the Bond market's payout token.
    /// @notice Recent TWAPs of the underlying must be registered in the TWAP oracle, otherwise the function will revert
    /// @param quoteToken_ The address of the quote token (ALM LP token) of the bond
    /// @param payoutToken_ The address of the payout token of the bond
    /// @return The price of payout tokens per quote token (ALM LP token)
    function currentPricePerLpToken(ERC20 quoteToken_, ERC20 payoutToken_) external view returns (uint256) {
        return _calculatePrice(quoteToken_, payoutToken_);
    }

    /// @dev Returns the price of quote tokens (ALM LP tokens) per payout token, what the teller expects
    function _currentPrice(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint256) {
        uint256 price = _calculatePrice(quoteToken_, payoutToken_);

        // Invert the price (quote/payout), using total precision of 36 decimals
        uint256 precision = 10 ** 36;

        // Return the inverted price, adjusted for payout token decimals
        return ((precision / price) * (10 ** payoutToken_.decimals())) / (10 ** 18);
    }

    /// @dev Returns the price of payout tokens per quote token (ALM LP token)
    function _calculatePrice(ERC20 quoteToken_, ERC20 payoutToken_) internal view returns (uint256) {
        ALMParams memory params = priceFeedParams[quoteToken_][payoutToken_];

        // Revert if no price feed params are set
        if (address(params.token0) == address(0)) revert BondOracle_BadFeed(address(0));

        (uint256 r0, uint256 r1) = params.almVault.getTotalAmounts();
        uint256 totalSupply = params.almVault.totalSupply();

        uint256 p0;
        uint256 p1;
        // If any of the underlyings in the pool are the payout token, get the twap price of the other underlying only
        if (params.token0 == address(payoutToken_)) {
            p0 = 10 ** uint256(params.token0Decimals);
            p1 = twapOracle.getPrice(params.token1, address(payoutToken_));
        } else if (params.token1 == address(payoutToken_)) {
            p0 = twapOracle.getPrice(params.token0, address(payoutToken_));
            p1 = 10 ** uint256(params.token1Decimals);
        } else {
            p0 = twapOracle.getPrice(params.token0, address(payoutToken_));
            p1 = twapOracle.getPrice(params.token1, address(payoutToken_));
        }

        uint256 totalReserve = (r0 * p0) / 10 ** params.token0Decimals + (r1 * p1) / 10 ** params.token1Decimals;
        return (totalReserve * 1e18) / totalSupply;
    }

    /* ========== DECIMALS ========== */

    function _decimals(ERC20 quoteToken_, ERC20 payoutToken_) internal view override returns (uint8) {
        ALMParams memory params = priceFeedParams[quoteToken_][payoutToken_];

        return params.decimals;
    }

    /* ========== ADMIN ========== */

    /// @dev We assume that quote token is the ALM Vault address
    function _setPair(ERC20 quoteToken_, ERC20 payoutToken_, bool supported_, bytes memory) internal override {
        if (supported_) {
            IALMVault vault = IALMVault(address(quoteToken_));

            // Token addresses
            address token0 = vault.token0();
            address token1 = vault.token1();

            uint8 decimals = vault.decimals();

            uint8 token0Decimals = ERC20(token0).decimals();
            uint8 token1Decimals = ERC20(token1).decimals();

            // Validate params
            if (
                token0 == address(0) ||
                token1 == address(0) ||
                decimals < 6 ||
                decimals > 18 ||
                token0Decimals < 6 ||
                token0Decimals > 18 ||
                token1Decimals < 6 ||
                token1Decimals > 18
            ) revert BondOracle_InvalidParams();

            // Store params for token pair
            priceFeedParams[quoteToken_][payoutToken_] = ALMParams({
                almVault: vault,
                token0: token0,
                token0Decimals: token0Decimals,
                token1: token1,
                token1Decimals: token1Decimals,
                decimals: decimals
            });
        } else {
            // Delete params for token pair
            delete priceFeedParams[quoteToken_][payoutToken_];
        }
    }
}
