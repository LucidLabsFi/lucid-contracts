// SPDX-License-Identifier: AGPL-3.0
pragma solidity >=0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

interface IBondTeller {
    /// @notice                 Exchange quote tokens for a bond in a specified market
    /// @param recipient_       Address of recipient of bond. Allows deposits for other addresses
    /// @param referrer_        Address of referrer who will receive referral fee. For frontends to fill.
    ///                         Direct calls can use the zero address for no referrer fee.
    /// @param id_              ID of the Market the bond is being purchased from
    /// @param amount_          Amount to deposit in exchange for bond
    /// @param minAmountOut_    Minimum acceptable amount of bond to receive. Prevents frontrunning
    /// @return                 Amount of payout token to be received from the bond
    /// @return                 Timestamp at which the bond token can be redeemed for the underlying token
    function purchase(address recipient_, address referrer_, uint256 id_, uint256 amount_, uint256 minAmountOut_) external returns (uint256, uint48);

    /// @notice          Get current fee charged by the teller based on the combined protocol and referrer fee
    /// @param issuer_   Address of the issuer of the bond
    /// @param referrer_ Address of the referrer
    /// @return          Fee in basis points (3 decimal places)
    function getFee(address issuer_, address referrer_) external view returns (uint48);

    /// @notice         Set protocol fee
    /// @notice         Must be guardian
    /// @param fee_     Protocol fee in basis points (3 decimal places)
    function setProtocolFee(uint48 fee_) external;

    /// @notice          Set the discount for creating bond tokens from the base protocol fee
    /// @dev             The discount is subtracted from the protocol fee to determine the fee
    ///                  when using create() to mint bond tokens without using an Auctioneer
    /// @param discount_ Create Fee Discount in basis points (3 decimal places)
    function setCreateFeeDiscount(uint48 discount_) external;

    /// @notice         Sets the fee for referrers to the protocol
    /// @notice         Must be guardian
    /// @param fee_     Referrer fee in basis points (3 decimal places)
    function setReferrerFee(uint48 fee_) external;

    /// @notice         Set the protocol fee for a specific issuer which applies to all their bonds
    /// @notice         If no fee is set for an issuer, the default protocol fee is used
    /// @notice         Must be guardian
    /// @param issuer_      Address of the issuer of the bond
    /// @param fee_        Protocol fee in basis points (3 decimal places)
    function setProtocolFeeForIssuer(address issuer_, uint48 fee_) external;

    /// @notice         Set the protocol fee recipient for the protocol fees of all the bonds of an issuer
    /// @notice         If no fee recipient is set for an issuer, the default protocol fee recipient is used
    /// @notice         Must be guardian
    /// @param issuer_      Address of the issuer of the bond
    /// @param feeRecipient_ Address of the fee recipient
    function setProtocolFeeRecipientForIssuer(address issuer_, address feeRecipient_) external;

    /// @notice         Claim fees accrued by sender in the input tokens and sends them to the provided address
    /// @param tokens_  Array of tokens to claim fees for
    /// @param to_      Address to send fees to
    function claimFees(ERC20[] memory tokens_, address to_) external;
}
