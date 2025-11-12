// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.15;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {ClonesWithImmutableArgs} from "./lib/ClonesWithImmutableArgs.sol";

import {BondBaseTeller, IBondAggregator, Authority, IBondVesting} from "./bases/BondBaseTeller.sol";
import {IBondFixedExpiryTeller} from "./interfaces/IBondFixedExpiryTeller.sol";
import {ERC20BondToken} from "./ERC20BondToken.sol";

import {TransferHelper} from "./lib/TransferHelper.sol";
import {FullMath} from "./lib/FullMath.sol";

/// @title Bond Fixed Expiry Teller
/// @notice Bond Fixed Expiry Teller Contract
/// @dev Bond Protocol is a permissionless system to create Olympus-style bond markets
///      for any token pair. The markets do not require maintenance and will manage
///      bond prices based on activity. Bond issuers create BondMarkets that pay out
///      a Payout Token in exchange for deposited Quote Tokens. Users can purchase
///      future-dated Payout Tokens with Quote Tokens at the current market price and
///      receive Bond Tokens to represent their position while their bond vests.
///      Once the Bond Tokens vest, they can redeem it for the Quote Tokens.
/// @dev The Bond Fixed Expiry Teller is an implementation of the
///      Bond Base Teller contract specific to handling user bond transactions
///      and tokenizing bond markets where all purchases vest at the same timestamp
///      as ERC20 tokens. Vesting timestamps are rounded to the nearest day to avoid
///      duplicate tokens with the same name/symbol.
///
/// @author Oighty, Zeus, Potted Meat, indigo
contract BondFixedExpiryTeller is BondBaseTeller, IBondFixedExpiryTeller {
    using TransferHelper for ERC20;
    using FullMath for uint256;
    using ClonesWithImmutableArgs for address;

    /* ========== EVENTS ========== */
    event ERC20BondTokenCreated(ERC20BondToken bondToken, ERC20 indexed underlying, uint48 indexed expiry);
    event BondRedeemed(address indexed recipient, address indexed underlying, address indexed bondToken, uint256 amount);

    /* ========== STATE VARIABLES ========== */
    /// @notice ERC20 bond tokens (unique to a underlying and expiry)
    mapping(ERC20 => mapping(uint48 => ERC20BondToken)) public bondTokens;

    /// @notice ERC20BondToken reference implementation (deployed on creation to clone from)
    ERC20BondToken public immutable bondTokenImplementation;

    /* ========== CONSTRUCTOR ========== */
    constructor(
        address protocol_,
        IBondAggregator aggregator_,
        address guardian_,
        Authority authority_,
        IBondVesting vesting_
    ) BondBaseTeller(protocol_, aggregator_, guardian_, authority_, vesting_) {
        bondTokenImplementation = new ERC20BondToken();
    }

    /* ========== PURCHASE ========== */

    /// @notice             Handle payout to recipient
    /// @param recipient_   Address to receive payout
    /// @param payout_      Amount of payoutToken to be paid
    /// @param underlying_   Token to be paid out
    /// @param terms_       Terms of the bond market(vesting, start, linearDuration, cliffDuration)
    /// @return expiry      Timestamp when the payout will vest
    function _handlePayout(
        address recipient_,
        uint256 payout_,
        ERC20 underlying_,
        uint48[4] memory terms_ // [vesting, start, linearDuration, cliffDuration]
    ) internal override returns (uint48 expiry) {
        // If there is no vesting time, the deposit is treated as an instant swap.
        // otherwise, deposit info is stored and payout is available at a future timestamp.
        // instant swap is denoted by expiry == 0.
        //
        // bonds mature with a cliff at a set timestamp
        // prior to the expiry timestamp, no payout tokens are accessible to the user
        // after the expiry timestamp, the entire payout can be redeemed
        //
        // fixed-expiry bonds mature at a set timestamp
        // i.e. expiry = day 10. when alice deposits on day 1, her term
        // is 9 days. when bob deposits on day 2, his term is 8 days.
        if (terms_[0] > uint48(block.timestamp)) {
            expiry = terms_[0];
            // Fixed-expiry bonds mint ERC-20 tokens
            bondTokens[underlying_][expiry].mint(recipient_, payout_);
        } else {
            // If no expiry, then treat as instant swap and create vesting schedule
            // Note: Vesting: Is fixed term ? Vesting length (seconds) : Vesting expiry (timestamp).
            underlying_.approve(address(bondVesting), payout_);
            // In Fixed Expiry, linearDuration is the end timestamp, so we calculate the vesting duration as end - start.
            uint256 linearDuration = uint256(terms_[2] - block.timestamp); // linear duration timestamp - now
            expiry = terms_[2];
            bondVesting.createVestingSchedule(recipient_, address(underlying_), uint256(block.timestamp), terms_[3], linearDuration, 1, payout_);
        }
    }

    /* ========== DEPOSIT/MINT ========== */

    /// @inheritdoc IBondFixedExpiryTeller
    function create(ERC20 underlying_, uint48 expiry_, uint256 amount_) external override nonReentrant returns (ERC20BondToken, uint256) {
        // Expiry is rounded to the nearest day at 0000 UTC (in seconds) since bond tokens
        // are only unique to a day, not a specific timestamp.
        uint48 expiry = uint48(expiry_ / 1 days) * 1 days;

        // Revert if expiry is in the past
        if (uint256(expiry) < block.timestamp) revert Teller_InvalidParams();

        ERC20BondToken bondToken = bondTokens[underlying_][expiry];

        // Revert if no token exists, must call deploy first
        if (bondToken == ERC20BondToken(address(0x00))) revert Teller_TokenDoesNotExist(underlying_, expiry);

        // Transfer in underlying
        // Check that amount received is not less than amount expected
        // Handles edge cases like fee-on-transfer tokens (which are not supported)
        uint256 oldBalance = underlying_.balanceOf(address(this));
        underlying_.safeTransferFrom(_msgSender(), address(this), amount_);
        if (underlying_.balanceOf(address(this)) < oldBalance + amount_) revert Teller_UnsupportedToken();

        // If fee is greater than the create discount, then calculate the fee and store it
        // Otherwise, fee is zero.
        if (protocolFee > createFeeDiscount) {
            // Calculate fee amount
            uint256 feeAmount = amount_.mulDiv(protocolFee - createFeeDiscount, FEE_DECIMALS);
            rewards[_protocol][underlying_] += feeAmount;

            // Mint new bond tokens
            bondToken.mint(_msgSender(), amount_ - feeAmount);

            return (bondToken, amount_ - feeAmount);
        } else {
            // Mint new bond tokens
            bondToken.mint(_msgSender(), amount_);

            return (bondToken, amount_);
        }
    }

    /* ========== REDEEM ========== */

    /// @inheritdoc IBondFixedExpiryTeller
    function redeem(ERC20BondToken token_, uint256 amount_) external override nonReentrant {
        // Validate token is issued by this teller
        ERC20 underlying = token_.underlying();
        uint48 expiry = token_.expiry();

        if (token_ != bondTokens[underlying][expiry]) revert Teller_UnsupportedToken();

        // Validate token expiry has passed
        if (uint48(block.timestamp) < expiry) revert Teller_TokenNotMatured(expiry);

        // Burn bond token and transfer underlying
        token_.burn(_msgSender(), amount_);
        underlying.safeTransfer(_msgSender(), amount_);

        emit BondRedeemed(_msgSender(), address(underlying), address(token_), amount_);
    }

    /* ========== TOKENIZATION ========== */

    /// @inheritdoc IBondFixedExpiryTeller
    function deploy(ERC20 underlying_, uint48 expiry_) external override nonReentrant returns (ERC20BondToken) {
        // Expiry is rounded to the nearest day at 0000 UTC (in seconds) since bond tokens
        // are only unique to a day, not a specific timestamp.
        uint48 expiry = uint48(expiry_ / 1 days) * 1 days;

        // Revert if expiry is in the past
        if (uint256(expiry) < block.timestamp) revert Teller_InvalidParams();

        // Create bond token if one doesn't already exist
        ERC20BondToken bondToken = bondTokens[underlying_][expiry];
        if (bondToken == ERC20BondToken(address(0))) {
            (string memory name, string memory symbol) = _getNameAndSymbol(underlying_, expiry);
            bytes memory tokenData = abi.encodePacked(
                bytes32(bytes(name)),
                bytes32(bytes(symbol)),
                uint8(underlying_.decimals()),
                underlying_,
                uint256(expiry),
                address(this)
            );
            bondToken = ERC20BondToken(address(bondTokenImplementation).clone(tokenData));
            bondTokens[underlying_][expiry] = bondToken;
            emit ERC20BondTokenCreated(bondToken, underlying_, expiry);
        }
        return bondToken;
    }

    /// @inheritdoc IBondFixedExpiryTeller
    function getBondTokenForMarket(uint256 id_) external view override returns (ERC20BondToken) {
        // Check that the id is for a market served by this teller
        if (address(_aggregator.getTeller(id_)) != address(this)) revert Teller_InvalidParams();

        // Get the underlying and expiry for the market
        (, , ERC20 underlying, , uint48[4] memory vestTerms, ) = _aggregator.getAuctioneer(id_).getMarketInfoForPurchase(id_);

        return bondTokens[underlying][vestTerms[0]];
    }

    /// @inheritdoc IBondFixedExpiryTeller
    function getBondToken(ERC20 underlying_, uint48 expiry_) external view override returns (ERC20BondToken) {
        // Expiry is rounded to the nearest day at 0000 UTC (in seconds) since bond tokens
        // are only unique to a day, not a specific timestamp.
        uint48 expiry = uint48(expiry_ / 1 days) * 1 days;

        ERC20BondToken bondToken = bondTokens[underlying_][expiry];

        // Revert if token does not exist
        if (address(bondToken) == address(0)) revert Teller_TokenDoesNotExist(underlying_, expiry);

        return bondToken;
    }
}
