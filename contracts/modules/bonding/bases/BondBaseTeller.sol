// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.15;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {ReentrancyGuard} from "solmate/src/utils/ReentrancyGuard.sol";
import {Auth, Authority} from "solmate/src/auth/Auth.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

import {IBondTeller} from "../interfaces/IBondTeller.sol";
import {IBondCallback} from "../interfaces/IBondCallback.sol";
import {IBondAggregator} from "../interfaces/IBondAggregator.sol";
import {IBondAuctioneer} from "../interfaces/IBondAuctioneer.sol";
import {IBondVesting} from "../interfaces/IBondVesting.sol";

import {TransferHelper} from "../lib/TransferHelper.sol";
import {FullMath} from "../lib/FullMath.sol";

/// @title Bond Teller
/// @notice Bond Teller Base Contract
/// @dev Bond Protocol is a permissionless system to create Olympus-style bond markets
///      for any token pair. The markets do not require maintenance and will manage
///      bond prices based on activity. Bond issuers create BondMarkets that pay out
///      a Payout Token in exchange for deposited Quote Tokens. Users can purchase
///      future-dated Payout Tokens with Quote Tokens at the current market price and
///      receive Bond Tokens to represent their position while their bond vests.
///      Once the Bond Tokens vest, they can redeem it for the Quote Tokens.
///
/// @dev The Teller contract handles all interactions with end users and manages tokens
///      issued to represent bond positions. Users purchase bonds by depositing Quote Tokens
///      and receive a Bond Token (token type is implementation-specific) that represents
///      their payout and the designated expiry. Once a bond vests, Investors can redeem their
///      Bond Tokens for the underlying Payout Token. A Teller requires one or more Auctioneer
///      contracts to be deployed to provide markets for users to purchase bonds from.
///
/// @author Oighty, Zeus, Potted Meat, indigo
abstract contract BondBaseTeller is IBondTeller, Context, Auth, ReentrancyGuard {
    using TransferHelper for ERC20;
    using FullMath for uint256;

    /* ========== ERRORS ========== */

    error Teller_InvalidCallback();
    error Teller_TokenNotMatured(uint48 maturesOn);
    error Teller_NotAuthorized();
    error Teller_TokenDoesNotExist(ERC20 underlying, uint48 expiry);
    error Teller_UnsupportedToken();
    error Teller_InvalidParams();

    /* ========== EVENTS ========== */
    event Bonded(uint256 indexed id, address indexed recipient, address indexed referrer, uint256 amount, uint256 payout);
    event ProtocolFeeSet(uint48 fee);
    event CreateFeeDiscountSet(uint48 discount);
    event ReferrerFeeSet(address indexed referrer, uint48 fee);
    event ProtocolFeeForIssuerSet(address indexed issuer, uint48 fee);
    event ProtocolFeeRecipientForIssuerSet(address indexed issuer, address indexed recipient);

    /* ========== STATE VARIABLES ========== */

    /// @notice Fee paid to the referrer in basis points (3 decimals). Set by the guardian, must be less than or equal to 25% (25e3).
    /// @dev There are some situations where the fees may round down to zero if quantity of baseToken
    ///      is < 1e5 wei (can happen with big price differences on small decimal tokens). This is purely
    ///      a theoretical edge case, as the bond amount would not be practical.
    uint48 public referrerFee;

    /// @notice Fee paid to protocol in basis points (3 decimal places).
    uint48 public protocolFee;

    /// @notice 'Create' function fee discount in basis points (3 decimal places). Amount standard fee is reduced by for partners who just want to use the 'create' function to issue bond tokens.
    uint48 public createFeeDiscount;

    uint48 public constant FEE_DECIMALS = 1e5; // one percent equals 1000.

    mapping(address => uint48) private _protocolFeesForIssuers;

    mapping(address => address) private _protocolFeeRecipients;

    /// @notice Fees earned by an address, by token
    mapping(address => mapping(ERC20 => uint256)) public rewards;

    // Address the protocol receives fees at
    address internal immutable _protocol;

    // BondAggregator contract with utility functions
    IBondAggregator internal immutable _aggregator;

    ///@notice BondVesting contract that handles vesting schedules
    IBondVesting public immutable bondVesting;

    constructor(
        address protocol_,
        IBondAggregator aggregator_,
        address guardian_,
        Authority authority_,
        IBondVesting vesting_
    ) Auth(guardian_, authority_) {
        _protocol = protocol_;
        _aggregator = aggregator_;
        bondVesting = vesting_;

        // Explicitly setting these values to zero to document
        protocolFee = 0;
        createFeeDiscount = 0;
        emit ProtocolFeeSet(0);
        emit CreateFeeDiscountSet(0);
    }

    /// @inheritdoc IBondTeller
    function setReferrerFee(uint48 fee_) external override requiresAuth {
        if ((fee_ > 25e3)) revert Teller_InvalidParams();
        referrerFee = fee_;
    }

    /// @inheritdoc IBondTeller
    function setProtocolFee(uint48 fee_) external override requiresAuth {
        if (fee_ > 25e3) revert Teller_InvalidParams();
        protocolFee = fee_;
        emit ProtocolFeeSet(fee_);
    }

    /// @inheritdoc IBondTeller
    function setCreateFeeDiscount(uint48 discount_) external override requiresAuth {
        if (discount_ > protocolFee) revert Teller_InvalidParams();
        createFeeDiscount = discount_;
        emit CreateFeeDiscountSet(discount_);
    }

    /// @inheritdoc IBondTeller
    function setProtocolFeeForIssuer(address issuer_, uint48 fee_) external override requiresAuth {
        if (fee_ > 25e3) revert Teller_InvalidParams();
        _protocolFeesForIssuers[issuer_] = fee_;
        emit ProtocolFeeForIssuerSet(issuer_, fee_);
    }

    /// @inheritdoc IBondTeller
    function setProtocolFeeRecipientForIssuer(address issuer_, address recipient_) external override requiresAuth {
        _protocolFeeRecipients[issuer_] = recipient_;
        emit ProtocolFeeRecipientForIssuerSet(issuer_, recipient_);
    }

    /// @inheritdoc IBondTeller
    function claimFees(ERC20[] memory tokens_, address to_) external override nonReentrant {
        uint256 len = tokens_.length;
        for (uint256 i; i < len; ++i) {
            ERC20 token = tokens_[i];
            uint256 send = rewards[_msgSender()][token];

            if (send != 0) {
                rewards[_msgSender()][token] = 0;
                token.safeTransfer(to_, send);
            }
        }
    }

    /// @inheritdoc IBondTeller
    function getFee(address issuer_, address referrer_) external view returns (uint48) {
        if (referrer_ == address(0)) {
            return getProtocolFeeFor(issuer_);
        } else {
            return getProtocolFeeFor(issuer_) + referrerFee;
        }
    }

    function getProtocolFeeFor(address _issuer) public view returns (uint48) {
        uint48 issuerFee = _protocolFeesForIssuers[_issuer];
        if (issuerFee != 0) {
            return issuerFee;
        } else {
            // default to protocolFee if no issuer fee is set
            return protocolFee;
        }
    }

    function getProtocolFeeRecipientFor(address _issuer) public view returns (address) {
        address recipient = _protocolFeeRecipients[_issuer];
        if (recipient != address(0)) {
            return recipient;
        } else {
            // default to protocol treasury address if no recipient address is set
            return _protocol;
        }
    }

    /* ========== USER FUNCTIONS ========== */

    /// @inheritdoc IBondTeller
    function purchase(
        address recipient_,
        address referrer_,
        uint256 id_,
        uint256 amount_,
        uint256 minAmountOut_
    ) external virtual nonReentrant returns (uint256, uint48) {
        ERC20 payoutToken;
        ERC20 quoteToken;
        uint48[3] memory vestTerms; //vesting, start, duration

        // Calculate fees for purchase
        // 1. Calculate referrer fee (if there is a referrer)
        // 2. Calculate protocol fee as the total expected fee amount minus the referrer fee
        //    to avoid issues with rounding from separate fee calculations
        uint256[3] memory amounts; // [referrer fees, protocol fees, payout]
        amounts[0] = (referrer_ == address(0)) ? 0 : amount_.mulDiv(referrerFee, FEE_DECIMALS);
        address issuer;
        {
            IBondAuctioneer auctioneer = _aggregator.getAuctioneer(id_);

            (issuer, , payoutToken, quoteToken, vestTerms, ) = auctioneer.getMarketInfoForPurchase(id_);

            uint48 referrerFee_ = (referrer_ == address(0)) ? 0 : referrerFee;
            // Calculate protocol fee for issuer
            amounts[1] = amount_.mulDiv(getProtocolFeeFor(issuer) + referrerFee_, FEE_DECIMALS) - amounts[0];

            // Auctioneer handles bond pricing, capacity, and duration
            uint256 amountLessFee = amount_ - amounts[0] - amounts[1];
            amounts[2] = auctioneer.purchaseBond(id_, amountLessFee, minAmountOut_);
        }

        // Allocate fees to protocol and referrer
        rewards[referrer_][quoteToken] += amounts[0];
        rewards[getProtocolFeeRecipientFor(issuer)][quoteToken] += amounts[1];

        // Transfer quote tokens from sender and ensure enough payout tokens are available
        _handleTransfers(id_, amount_, amounts[2], amounts[0] + amounts[1]);

        // Handle payout to user (either transfer tokens if instant swap or issue bond token)
        uint48 expiry = _handlePayout(recipient_, amounts[2], payoutToken, vestTerms);

        emit Bonded(id_, recipient_, referrer_, amount_, amounts[2]);

        return (amounts[2], expiry);
    }

    /// @notice     Handles transfer of funds from user and market owner/callback
    function _handleTransfers(uint256 id_, uint256 amount_, uint256 payout_, uint256 feePaid_) internal {
        // Get info from auctioneer
        (address owner, address callbackAddr, ERC20 payoutToken, ERC20 quoteToken, , ) = _aggregator.getAuctioneer(id_).getMarketInfoForPurchase(id_);

        // Calculate amount net of fees
        uint256 amountLessFee = amount_ - feePaid_;

        // Have to transfer to teller first since fee is in quote token
        // Check balance before and after to ensure full amount received, revert if not
        // Handles edge cases like fee-on-transfer tokens (which are not supported)
        uint256 quoteBalance = quoteToken.balanceOf(address(this));
        quoteToken.safeTransferFrom(_msgSender(), address(this), amount_);
        if (quoteToken.balanceOf(address(this)) < quoteBalance + amount_) revert Teller_UnsupportedToken();

        // If callback address supplied, transfer tokens from teller to callback, then execute callback function,
        // and ensure proper amount of tokens transferred in.
        if (callbackAddr != address(0)) {
            // Send quote token to callback (transferred in first to allow use during callback)
            quoteToken.safeTransfer(callbackAddr, amountLessFee);

            // Call the callback function to receive payout tokens for payout
            uint256 payoutBalance = payoutToken.balanceOf(address(this));
            IBondCallback(callbackAddr).callback(id_, amountLessFee, payout_);

            // Check to ensure that the callback sent the requested amount of payout tokens back to the teller
            if (payoutToken.balanceOf(address(this)) < (payoutBalance + payout_)) revert Teller_InvalidCallback();
        } else {
            // If no callback is provided, transfer tokens from market owner to this contract
            // for payout.
            // Check balance before and after to ensure full amount received, revert if not
            // Handles edge cases like fee-on-transfer tokens (which are not supported)
            uint256 payoutBalance = payoutToken.balanceOf(address(this));
            payoutToken.safeTransferFrom(owner, address(this), payout_);
            if (payoutToken.balanceOf(address(this)) < (payoutBalance + payout_)) revert Teller_UnsupportedToken();

            quoteToken.safeTransfer(owner, amountLessFee);
        }
    }

    /// @notice             Handle payout to recipient
    /// @dev                Implementation-agnostic. Must be implemented in contracts that
    ///                     extend this base since it is called by purchase.
    /// @param recipient_   Address to receive payout
    /// @param payout_      Amount of payoutToken to be paid
    /// @param underlying_   Token to be paid out
    /// @param terms_       Terms of the bond market(vesting, start, linearDuration)
    /// @return expiry      Timestamp when the payout will vest
    function _handlePayout(
        address recipient_,
        uint256 payout_,
        ERC20 underlying_,
        uint48[3] memory terms_ // [vesting, start, linearDuration]
    ) internal virtual returns (uint48 expiry);

    /// @notice             Derive name and symbol of token for market
    /// @param underlying_   Underlying token to be paid out when the Bond Token vests
    /// @param expiry_      Timestamp that the Bond Token vests at
    /// @return name        Bond token name, format is "Token YYYY-MM-DD"
    /// @return symbol      Bond token symbol, format is "TKN-YYYYMMDD"
    function _getNameAndSymbol(ERC20 underlying_, uint256 expiry_) internal view returns (string memory name, string memory symbol) {
        // Convert a number of days into a human-readable date, courtesy of BokkyPooBah.
        // Source: https://github.com/bokkypoobah/BokkyPooBahsDateTimeLibrary/blob/master/contracts/BokkyPooBahsDateTimeLibrary.sol

        uint256 year;
        uint256 month;
        uint256 day;
        {
            int256 __days = int256(expiry_ / 1 days);

            int256 num1 = __days + 68569 + 2440588; // 2440588 = OFFSET19700101
            int256 num2 = (4 * num1) / 146097;
            num1 = num1 - (146097 * num2 + 3) / 4;
            int256 _year = (4000 * (num1 + 1)) / 1461001;
            num1 = num1 - (1461 * _year) / 4 + 31;
            int256 _month = (80 * num1) / 2447;
            int256 _day = num1 - (2447 * _month) / 80;
            num1 = _month / 11;
            _month = _month + 2 - 12 * num1;
            _year = 100 * (num2 - 49) + _year + num1;

            year = uint256(_year);
            month = uint256(_month);
            day = uint256(_day);
        }

        string memory yearStr = _uint2str(year % 10000);
        string memory monthStr = month < 10 ? string(abi.encodePacked("0", _uint2str(month))) : _uint2str(month);
        string memory dayStr = day < 10 ? string(abi.encodePacked("0", _uint2str(day))) : _uint2str(day);

        // Construct name/symbol strings.
        name = string(abi.encodePacked(underlying_.name(), " ", yearStr, "-", monthStr, "-", dayStr));
        symbol = string(abi.encodePacked(underlying_.symbol(), "-", yearStr, monthStr, dayStr));
    }

    // Some fancy math to convert a uint into a string, courtesy of Provable Things.
    // Updated to work with solc 0.8.0.
    // https://github.com/provable-things/ethereum-api/blob/master/provableAPI_0.6.sol
    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k - 1;
            uint8 temp = (48 + uint8(_i - (_i / 10) * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }
}
