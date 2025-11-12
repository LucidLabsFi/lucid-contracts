// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {TAParserLib} from "./lib/TAParserLib.sol";
import {ITWAPOracle} from "./interfaces/ITWAPOracle.sol";
import {OwnableInit} from "../../utils/access/OwnableInit.sol";

/**
 * @title TWAPOracle
 * @dev This contract is used to decode TWAP (Time Weighted Average Price) data from attestations and storing them on chain.
 */
contract TWAPOracle is OwnableInit, ITWAPOracle {
    /// @notice Event emitted when a new TWAP is registered.
    /// @param price The price of the TWAP.
    /// @param timestamp The unix timestamp in seconds when the TWAP was registered.
    event TWAPRegistered(address baseToken, address quoteToken, uint256 price, uint256 timestamp);

    /// @notice Event emitted when the TA signing key address is set.
    /// @param signer The address of the TA signing key.
    event TASignerSet(address signer);

    /// @notice Event emitted when the TWAP expiration time is set.
    /// @param twapExpiration The expiration time for TWAP data in seconds.
    event TWAPExpirationSet(uint64 twapExpiration);

    /// @notice Error thrown when the claims in the attestation are invalid.
    error TWAPOracle_InvalidClaims();

    /// @notice Error thrown when the TWAP price has expired.
    error TWAPOracle_PriceExpired();

    /// @notice Error thrown when the TWAP data is outdated and a more recent one is available.
    error TWAPOracle_OutdatedData();

    /// @notice Mapping of token pairs (baseToken/quoteToken) to their TWAP data.
    mapping(address => mapping(address => TWAP)) public twaps;

    /// @notice Expiration time for TWAP data in seconds.
    uint64 public twapExpiration;

    /// @notice Address of the TA signing key, used to verify the attestation.
    address public taSigner;

    /// @notice Constructor for the TWAPOracle contract.
    /// @param _signingKey The address of the TA signing key.
    /// @param _owner The address of the contract owner.
    constructor(address _signingKey, address _owner, uint64 _expiration) OwnableInit(_owner) {
        taSigner = _signingKey;
        twapExpiration = _expiration;
        emit TASignerSet(_signingKey);
        emit TWAPExpirationSet(_expiration);
    }

    /// @notice Registers TWAPs using the provided attestation data.
    /// @dev The attestation data must be signed by the TA signing key.
    /// @param taData An array containing different transitive attestations with the TWAP data.
    function registerAttestation(bytes[] calldata taData) public virtual {
        for (uint256 i = 0; i < taData.length; i++) {
            TAParserLib.FnCallClaims memory claims = TAParserLib.verifyTransitivelyAttestedFnCall(taSigner, taData[i]);
            (bytes memory baseToken, bytes memory quoteToken, uint256 price, uint256 chainId, uint64 timestamp) = abi.decode(
                claims.Output,
                (bytes, bytes, uint256, uint256, uint64)
            );

            address quoteTokenAddr;
            address baseTokenAddr;
            assembly {
                baseTokenAddr := mload(add(baseToken, 20))
                quoteTokenAddr := mload(add(quoteToken, 20))
            }

            if (baseTokenAddr == address(0) || quoteTokenAddr == address(0) || chainId != block.chainid) revert TWAPOracle_InvalidClaims();
            if (twaps[baseTokenAddr][quoteTokenAddr].timestamp > timestamp) revert TWAPOracle_OutdatedData();
            twaps[baseTokenAddr][quoteTokenAddr] = TWAP(price, timestamp);

            emit TWAPRegistered(baseTokenAddr, quoteTokenAddr, price, timestamp);
        }
    }

    /// @notice Returns the TWAP data for a token. Would revert if the TWAP is expired or not found.
    /// @dev Returns how much quoteTokens are needed for 1 baseToken.
    /// @param baseToken The address of the first token in the pair.
    /// @param quoteToken The address of the second token in the pair.
    function getPrice(address baseToken, address quoteToken) external view returns (uint256) {
        TWAP memory twap = twaps[baseToken][quoteToken];
        if ((twap.timestamp == 0) || (block.timestamp - twap.timestamp > twapExpiration)) revert TWAPOracle_PriceExpired();
        return twap.price;
    }

    function getPriceExpirationDate(address baseToken, address quoteToken) external view returns (uint256) {
        TWAP memory twap = twaps[baseToken][quoteToken];
        return twap.timestamp == 0 ? 0 : twap.timestamp + twapExpiration; // if timestamp == 0, return 0, else timestamp + expiration
    }

    /// @notice Sets the TA signing key address.
    /// @dev Only the contract owner can call this function.
    /// @param _signingKey The address of the new TA signing key.
    function setTaSigner(address _signingKey) external onlyOwner {
        taSigner = _signingKey;
        emit TASignerSet(_signingKey);
    }

    /// @notice Sets the expiration time for TWAP data.
    /// @dev Only the contract owner can call this function.
    /// @param _twapExpiration The new expiration time in seconds.
    function setTwapExpiration(uint64 _twapExpiration) external onlyOwner {
        twapExpiration = _twapExpiration;
        emit TWAPExpirationSet(_twapExpiration);
    }
}
