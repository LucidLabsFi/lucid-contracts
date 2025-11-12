import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import * as fs from "fs";
import * as path from "path";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {Contract, Signer} from "ethers";

let ownerSigner: SignerWithAddress;
let user1Signer: SignerWithAddress;
let twapOracle: Contract;
let evmLinkData: any;
//let signerAddress: SignerWithAddress;
let signerAddress: string;

// Addresses in the attestation:
const baseToken = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const quoteToken = "0x7ceB23FD6Bc0F9ab16970ADB4F2c47d08b8c7396";
const twapExpiration = 120;

function loadEVMLinkData(jsonPath: string) {
    try {
        const dir = path.resolve(__dirname, jsonPath);
        const file = fs.readFileSync(dir, "utf-8"); // specify encoding to avoid needing Buffer

        const data = JSON.parse(file);

        const k = data.enclave_attested_application_public_key.claims.public_key.data;
        const pubKeyBytes = ethers.utils.base64.decode(k);
        const publicKeyHex = Buffer.from(pubKeyBytes).toString("hex");

        const taBytes = ethers.utils.base64.decode(data.transitive_attested_function_call.transitive_attestation);
        const ta = Buffer.from(taBytes).toString("hex"); // attestation for base/quote, price: 178840, timestamp: 1745024638

        return {
            publicKey: `0x${publicKeyHex}`,
            transitiveAttestation: `0x${ta}`,
        };
    } catch (e) {
        console.log(`e`, e);
    }
}

describe("TWAPOracle Tests", function () {
    beforeEach(async () => {
        [ownerSigner, user1Signer] = await ethers.getSigners();

        evmLinkData = loadEVMLinkData("./inputs/twap.json");

        // Get ethereum address from public key
        const publicKey = evmLinkData.publicKey;
        const publicKeyBytes = ethers.utils.arrayify(publicKey);
        signerAddress = ethers.utils.computeAddress(publicKeyBytes);

        // Deploy TWAPDecoder
        const TWAPOracle = await ethers.getContractFactory("MockTWAPOracle");
        twapOracle = await TWAPOracle.deploy(signerAddress, ownerSigner.address, twapExpiration);
    });
    describe("Constructor", function () {
        it("should set the correct signer address", async () => {
            const signer = await twapOracle.taSigner();
            expect(signer).to.equal(signerAddress);
        });
        it("should set the correct owner address", async () => {
            const owner = await twapOracle.owner();
            expect(owner).to.equal(ownerSigner.address);
        });
        it("should set the twapExpiration", async () => {
            const expiration = await twapOracle.twapExpiration();
            expect(expiration).to.equal(twapExpiration);
        });
    });
    describe("getPrice", function () {
        beforeEach(async () => {
            const currentTimestamp = await helpers.time.latest();
            await twapOracle.setPrice(quoteToken, baseToken, ethers.utils.parseEther("12"), currentTimestamp);
        });
        it("should return the correct price", async () => {
            const price = await twapOracle.getPrice(quoteToken, baseToken);
            expect(price).to.equal(ethers.utils.parseEther("12"));
        });
        it("should revert if the price is not set", async () => {
            await twapOracle.setPrice(quoteToken, baseToken, 0, 0);
            await expect(twapOracle.getPrice(quoteToken, baseToken)).to.be.revertedWithCustomError(twapOracle, "TWAPOracle_PriceExpired");
        });
        it("should revert if the price is expired", async () => {
            const currentTimestamp = await helpers.time.latest();
            await twapOracle.setPrice(baseToken, quoteToken, ethers.utils.parseEther("12"), currentTimestamp - 300);
            await expect(twapOracle.getPrice(baseToken, quoteToken)).to.be.revertedWithCustomError(twapOracle, "TWAPOracle_PriceExpired");
        });
    });
    describe("setTaSigner", function () {
        it("should set the correct TA signing key address", async () => {
            const newSignerAddress = ethers.Wallet.createRandom().address;
            await twapOracle.setTaSigner(newSignerAddress);
            const signer = await twapOracle.taSigner();
            expect(signer).to.equal(newSignerAddress);
        });
        it("should revert if called by non-owner", async () => {
            const newSignerAddress = ethers.Wallet.createRandom().address;
            await expect(twapOracle.connect(user1Signer).setTaSigner(newSignerAddress)).to.be.revertedWithCustomError(
                twapOracle,
                "OwnableUnauthorizedAccount"
            );
        });
    });
    describe("setTWAPExpiration", function () {
        it("should set the correct expiration", async () => {
            const newExpiration = 300;
            await twapOracle.setTwapExpiration(newExpiration);
            const expiration = await twapOracle.twapExpiration();
            expect(expiration).to.equal(newExpiration);
        });
        it("should revert if called by non-owner", async () => {
            const newExpiration = 300;
            await expect(twapOracle.connect(user1Signer).setTwapExpiration(newExpiration)).to.be.revertedWithCustomError(
                twapOracle,
                "OwnableUnauthorizedAccount"
            );
        });
    });
    describe("registerAttestation", function () {
        it("shoud verify attested TWAP in User contract emitting an event", async () => {
            const transitiveAttestation = evmLinkData.transitiveAttestation;
            const tx = await twapOracle.registerAttestation([transitiveAttestation]);

            await expect(tx).to.emit(twapOracle, "TWAPRegistered").withArgs(baseToken, quoteToken, 178840, 1745024638);
        });
        it("should revert if the attestation is outdated", async () => {
            const currentTimestamp = await helpers.time.latest();
            await twapOracle.setPrice(baseToken, quoteToken, ethers.utils.parseEther("12"), currentTimestamp + 50);

            const transitiveAttestation = evmLinkData.transitiveAttestation;
            await expect(twapOracle.registerAttestation([transitiveAttestation])).to.be.revertedWithCustomError(
                twapOracle,
                "TWAPOracle_OutdatedData"
            );
        });
        it("should store the twap attestation", async () => {
            const transitiveAttestation = evmLinkData.transitiveAttestation;
            await twapOracle.registerAttestation([transitiveAttestation]);

            const twap = await twapOracle.twaps(baseToken, quoteToken);
            expect(twap[0]).to.equal(178840);
            expect(twap[1]).to.equal(1745024638);
        });
    });
    describe("getPriceExpirationDate", function () {
        it("should return the correct expiration date", async () => {
            const currentTimestamp = await helpers.time.latest();
            await twapOracle.setPrice(baseToken, quoteToken, ethers.utils.parseEther("12"), currentTimestamp);

            const expiry = await twapOracle.twapExpiration();
            const twapTimestamp = await twapOracle.twaps(baseToken, quoteToken);
            const expirationDate = await twapOracle.getPriceExpirationDate(baseToken, quoteToken);
            expect(expirationDate).to.equal(twapTimestamp[1].add(expiry));
        });
        it("should return 0 if the price is not set", async () => {
            const expirationDate = await twapOracle.getPriceExpirationDate(quoteToken, baseToken);
            expect(expirationDate).to.equal(0);
        });
    });
});
