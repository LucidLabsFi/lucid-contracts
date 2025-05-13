// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {TWAPOracle, TAParserLib} from "../TWAPOracle.sol";

contract MockTWAPOracle is TWAPOracle {
    constructor(address _signingKey, address _owner, uint64 _expiration) TWAPOracle(_signingKey, _owner, _expiration) {}

    function setPrice(address quoteToken, address baseToken, uint256 price, uint64 timestamp) public {
        twaps[quoteToken][baseToken] = TWAP(price, timestamp);
    }

    /// @dev Overriden function that doesn't check chainId
    function registerAttestation(bytes calldata taData) public override {
        TAParserLib.FnCallClaims memory claims = TAParserLib.verifyTransitivelyAttestedFnCall(taSigner, taData);
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
        baseTokenAddr = address(baseTokenAddr);
        quoteTokenAddr = address(quoteTokenAddr);

        // if (baseTokenAddr == address(0) || quoteTokenAddr == address(0) || chainId != block.chainid) revert TWAPOracle_InvalidClaims();
        if (twaps[baseTokenAddr][quoteTokenAddr].timestamp > timestamp) revert TWAPOracle_OutdatedData();
        twaps[baseTokenAddr][quoteTokenAddr] = TWAP(price, timestamp);

        emit TWAPRegistered(baseTokenAddr, quoteTokenAddr, price, timestamp);
    }
}
