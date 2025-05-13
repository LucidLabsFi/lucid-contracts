//  SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {BytesLib} from "solidity-bytes-utils/contracts/BytesLib.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

library TAParserLib {
    error UnknownSigner();
    error InvalidLength(uint256 expected, uint256 actual);

    struct TA {
        bytes Data;
        bytes Sig;
    }

    struct FnCallClaims {
        bytes HashOfCode;
        bytes Function;
        bytes HashOfInput;
        bytes HashOfSecrets;
        bytes Output;
    }

    function verifyTransitivelyAttestedFnCall(
        address applicationPublicKey,
        bytes calldata transitiveAttestation
    ) internal pure returns (FnCallClaims memory) {
        bytes memory verifiedTAData = _verifyTA(applicationPublicKey, transitiveAttestation);
        return _decodeFnCallClaims(verifiedTAData);
    }

    function _verifyTA(address signer, bytes calldata transitiveAttestation) private pure returns (bytes memory) {
        TA memory ta = _decodeTA(transitiveAttestation);

        bytes memory sigAsBytes = ta.Sig;
        bytes32 r = BytesLib.toBytes32(sigAsBytes, 0);
        bytes32 s = BytesLib.toBytes32(sigAsBytes, 32);
        uint8 v = 27 + uint8(sigAsBytes[64]);

        bytes memory dataAsBytes = ta.Data;
        bytes32 dataHash = keccak256(dataAsBytes);
        address recovered = ECDSA.recover(dataHash, v, r, s);

        if (signer != recovered) revert UnknownSigner();
        return ta.Data;
    }

    function _decodeTA(bytes calldata taData) private pure returns (TA memory) {
        TA memory ta;

        bytes[] memory decodedTA = abi.decode(taData, (bytes[]));

        if (decodedTA.length != 2) revert InvalidLength(2, decodedTA.length);

        ta.Data = decodedTA[0];
        ta.Sig = decodedTA[1];

        return ta;
    }

    function _decodeFnCallClaims(bytes memory data) private pure returns (FnCallClaims memory) {
        FnCallClaims memory claims;

        bytes[] memory decodedData = abi.decode(data, (bytes[]));
        if (decodedData.length != 5) revert InvalidLength(5, decodedData.length);

        claims.HashOfCode = decodedData[0];
        claims.Function = decodedData[1];
        claims.HashOfInput = decodedData[2];
        claims.Output = decodedData[3];
        claims.HashOfSecrets = decodedData[4];

        return claims;
    }
}
