import {expect} from "chai";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("BondFixedExpiryOFDA Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress; // collect protocol fees
    let feeRecipient: SignerWithAddress;

    let authority: Contract;
    let aggregator: Contract;
    let teller: Contract;
    let auctioner: Contract;
    let payoutToken: Contract;
    let quoteToken: Contract;
    let oracle: Contract;
    let priceFeed1: Contract;
    let vesting: Contract;
    let vestingTimestamp: number;
    let bondDuration: number;
    let createTx: any;

    beforeEach(async () => {
        const hardhatTimestamp = (await ethers.provider.getBlock("latest")).timestamp * 1000; // in milliseconds

        let vestingDate = new Date(hardhatTimestamp + 7 * 24 * 60 * 60 * 1000); // Add 7 days to the current date
        // Set the time to 00:00 UTC
        vestingDate.setUTCHours(0);
        vestingDate.setUTCMinutes(0);
        vestingDate.setUTCSeconds(0);
        vestingDate.setUTCMilliseconds(0);

        vestingTimestamp = Math.floor(vestingDate.getTime() / 1000); // Get the Unix timestamp in seconds
        bondDuration = 518400; // 6 days in seconds

        [ownerSigner, user1Signer, feeRecipient] = await ethers.getSigners();

        // Deploy Vesting
        const Vesting = await ethers.getContractFactory("BondVesting");
        vesting = await Vesting.deploy();

        // Deploy Authority
        const Authority = await ethers.getContractFactory("BondAuthority");
        authority = await Authority.deploy(ownerSigner.address, ethers.constants.AddressZero);

        // Deploy Aggregator
        const Aggregator = await ethers.getContractFactory("BondAggregator");
        aggregator = await Aggregator.deploy(ownerSigner.address, authority.address);

        // Create Payout token
        const PayoutToken = await ethers.getContractFactory("SimpleToken");
        payoutToken = await PayoutToken.connect(ownerSigner).deploy();

        // Create Payout token
        quoteToken = await PayoutToken.connect(user1Signer).deploy();
    });
    describe("Referrer Fees", () => {
        beforeEach(async () => {
            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedExpiryTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedExpiryFPA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should not allow a non-owner to set the referrer fee", async () => {
            await expect(teller.connect(user1Signer).setReferrerFee(500)).to.be.revertedWith("UNAUTHORIZED");
        });
        it("should allow the owner to set the referrer fees for user1Signer", async () => {
            await teller.setReferrerFee(500);
            const fee = await teller.referrerFee();
            expect(fee).to.be.equal(500);
        });
        it("should recvert if the referrer fee is higher than 25%", async () => {
            await expect(teller.setReferrerFee(30000)).to.be.revertedWithCustomError(teller, "Teller_InvalidParams");
        });
        it("should return the protocol fee with the referrer fee is a referral address is provided", async () => {
            await teller.setReferrerFee(500);
            const fee = await teller.getFee(ethers.constants.AddressZero, ownerSigner.address);
            const protocolFee = await teller.protocolFee();
            expect(fee).to.be.equal(protocolFee + 500);
        });
    });
    describe("Protocol Fees for Issuers", () => {
        beforeEach(async () => {
            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedExpiryTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedExpiryFPA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should not allow a non-owner to set the protocol fee for an issuer", async () => {
            await expect(teller.connect(user1Signer).setProtocolFeeForIssuer(ownerSigner.address, 500)).to.be.revertedWith("UNAUTHORIZED");
        });
        it("should allow the owner to set the protocol fee for an issuer", async () => {
            await teller.setProtocolFee(500);
            await teller.setProtocolFeeForIssuer(user1Signer.address, 1500);
            const fee = await teller.getProtocolFeeFor(user1Signer.address);
            expect(fee).to.be.equal(1500);
        });
        it("should return the default protocol fee if a fee is not set for an issuer", async () => {
            await teller.setProtocolFee(500);
            await teller.setProtocolFeeForIssuer(user1Signer.address, 1500);
            const fee = await teller.getProtocolFeeFor(ownerSigner.address);
            expect(fee).to.be.equal(500);
        });
        it("should return the issuer protocol fee if getFee() is called", async () => {
            await teller.setProtocolFee(500);
            await teller.setProtocolFeeForIssuer(user1Signer.address, 1500);
            const fee = await teller.getFee(user1Signer.address, ethers.constants.AddressZero);
            expect(fee).to.be.equal(1500);
        });
        it("should allow setting zero fee for an issuer and distinguish it from unset fee", async () => {
            // Set default protocol fee to 1000 (1%)
            await teller.setProtocolFee(1000);

            // Initially, issuer should use default protocol fee
            expect(await teller.getProtocolFeeFor(user1Signer.address)).to.equal(1000);
            expect(await teller.isProtocolFeeSetForIssuer(user1Signer.address)).to.be.false;

            // Set issuer fee to 0
            await teller.setProtocolFeeForIssuer(user1Signer.address, 0);

            // Should now return 0, not the default protocol fee
            expect(await teller.getProtocolFeeFor(user1Signer.address)).to.equal(0);
            expect(await teller.isProtocolFeeSetForIssuer(user1Signer.address)).to.be.true;
        });
        it("should allow clearing issuer fee and revert to default", async () => {
            // Set default protocol fee and issuer specific fee
            await teller.setProtocolFee(1000);
            await teller.setProtocolFeeForIssuer(user1Signer.address, 500);

            expect(await teller.getProtocolFeeFor(user1Signer.address)).to.equal(500);
            expect(await teller.isProtocolFeeSetForIssuer(user1Signer.address)).to.be.true;

            // Clear the issuer fee
            await teller.clearProtocolFeeForIssuer(user1Signer.address);

            // Should now return default protocol fee again
            expect(await teller.getProtocolFeeFor(user1Signer.address)).to.equal(1000);
            expect(await teller.isProtocolFeeSetForIssuer(user1Signer.address)).to.be.false;
        });
        it("should not allow non-owner to clear protocol fee for issuer", async () => {
            await expect(teller.connect(user1Signer).clearProtocolFeeForIssuer(ownerSigner.address)).to.be.revertedWith("UNAUTHORIZED");
        });
    });
    describe("Protocol Fees Recipients for Issuers", () => {
        beforeEach(async () => {
            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedExpiryTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedExpiryFPA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should not allow a non-owner to set the protocol fee recipient for an issuer", async () => {
            await expect(teller.connect(user1Signer).setProtocolFeeRecipientForIssuer(ownerSigner.address, feeRecipient.address)).to.be.revertedWith(
                "UNAUTHORIZED"
            );
        });
        it("should allow the owner to set the protocol fee recipient for an issuer", async () => {
            await teller.setProtocolFeeRecipientForIssuer(user1Signer.address, feeRecipient.address);
            const recipient = await teller.getProtocolFeeRecipientFor(user1Signer.address);
            expect(recipient).to.be.equal(feeRecipient.address);
        });
        it("should return the default protocol fee recipient (treasury) if a recipient is not set for an issuer", async () => {
            await teller.setProtocolFeeRecipientForIssuer(user1Signer.address, feeRecipient.address);
            const recipient = await teller.getProtocolFeeRecipientFor(ownerSigner.address);
            expect(recipient).to.be.equal(user1Signer.address); // set during teller deployment
        });
    });
    describe("Fixed-expiry market", () => {
        beforeEach(async () => {
            // Deploy Mock Price Feed 1 - Payout/Quote token
            const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
            priceFeed1 = await MockPriceFeed.deploy();
            // Set the price feed
            await priceFeed1.setLatestAnswer(ethers.utils.parseEther("5"));
            await priceFeed1.setDecimals(18);
            await priceFeed1.setTimestamp(Math.floor(Date.now() / 1000));
            await priceFeed1.setStartedAt(Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000)); // Set started at 2 hours ago
            await priceFeed1.setRoundId(1);
            await priceFeed1.setAnsweredInRound(1);

            // // Deploy Mock Price Feed 2 - for scenario 3 or 4
            // priceFeed2 = await MockPriceFeed.deploy();
            // // Set the price feed
            // await priceFeed2.setLatestAnswer(ethers.utils.parseEther("1"));
            // await priceFeed2.setDecimals(18);
            // await priceFeed2.setTimestamp(Math.floor(Date.now() / 1000));
            // await priceFeed2.setStartedAt(Math.floor(Date.now() / 1000));
            // await priceFeed2.setRoundId(1);
            // await priceFeed2.setAnsweredInRound(1);

            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedExpiryTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedExpiryOFDA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Deploy Oracle
            const Oracle = await ethers.getContractFactory("BondChainlinkOracle");
            oracle = await Oracle.deploy(aggregator.address, [auctioner.address], ownerSigner.address); // We need the addresses of all the auctioners to register them in the oracle

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should create a fixed-expiry market, transfering the payout tokens ", async () => {
            // Set price in Oracle - admins
            // Check documentation in BondChainLinkOracle.sol on how to configure price feeds
            // Scenario 1
            const encodedOracleParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, uint48, address, uint48, uint8, bool)"],
                [[priceFeed1.address, "7200", ethers.constants.AddressZero, "0", "18", false]]
            ); // numeratorUpdateThreshold must be between 1 day and 1 week - 3600 and 604800 seconds

            // call setPair in oracle - quote, payout, supported, oracle params
            await oracle.setPair(quoteToken.address, payoutToken.address, true, encodedOracleParams);

            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "20000",
                        "50000",
                        false,
                        ethers.utils.parseEther("10000"),
                        "36000",
                        vestingTimestamp,
                        "0",
                        bondDuration,
                        "0",
                        "0",
                        "0",
                    ],
                ]
            );
            // Call create market
            await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await payoutToken.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));

            //
            // Purchase bond
            //
            // Approve tokens
            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("400"));
            // Purchase bond
            await teller
                .connect(user1Signer)
                .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("400"), ethers.utils.parseEther("100"));

            //
            // Claim bond
            //
            // Jump in time in hardhat
            await helpers.time.increase(bondDuration * 2);
            // Set an updated price in the oracle Oracle due to numeratorUpdateThreshold logic because we jumped in time
            await priceFeed1.setLatestAnswer(ethers.utils.parseEther("5"));
            await priceFeed1.setDecimals(18);
            await priceFeed1.setTimestamp(Math.floor(Date.now() / 1000) + bondDuration * 2);
            await priceFeed1.setRoundId(2);
            await priceFeed1.setAnsweredInRound(2);

            // Get bond address
            const bondToken = await teller.getBondTokenForMarket(0); // 0 is market id
            // Attach bond token to SimpleToken contract and call balance of
            const bondTokenContract = await ethers.getContractAt("SimpleToken", bondToken);
            const balance = await bondTokenContract.balanceOf(user1Signer.address);
            // Claim bond
            await teller.connect(user1Signer).redeem(bondToken, balance);

            expect(await payoutToken.balanceOf(user1Signer.address)).to.be.equal(balance); //Payout tokens should be transfered to the user 1:1
        });
    });
    describe("Fixed-expiry linear vesting bonds", () => {
        beforeEach(async () => {
            // Deploy Mock Price Feed 1 - Payout/Quote token
            const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
            priceFeed1 = await MockPriceFeed.deploy();
            // Set the price feed
            await priceFeed1.setLatestAnswer(ethers.utils.parseEther("5"));
            await priceFeed1.setDecimals(18);
            await priceFeed1.setTimestamp(Math.floor(Date.now() / 1000));
            await priceFeed1.setStartedAt(Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000)); // Set started at 2 hours ago
            await priceFeed1.setRoundId(1);
            await priceFeed1.setAnsweredInRound(1);

            // // Deploy Mock Price Feed 2 - for scenario 3 or 4
            // priceFeed2 = await MockPriceFeed.deploy();
            // // Set the price feed
            // await priceFeed2.setLatestAnswer(ethers.utils.parseEther("1"));
            // await priceFeed2.setDecimals(18);
            // await priceFeed2.setTimestamp(Math.floor(Date.now() / 1000));
            // await priceFeed2.setStartedAt(Math.floor(Date.now() / 1000));
            // await priceFeed2.setRoundId(1);
            // await priceFeed2.setAnsweredInRound(1);

            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedExpiryTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedExpiryOFDA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Deploy Oracle
            const Oracle = await ethers.getContractFactory("BondChainlinkOracle");
            oracle = await Oracle.deploy(aggregator.address, [auctioner.address], ownerSigner.address); // We need the addresses of all the auctioners to register them in the oracle

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);

            // Set price in Oracle - admins
            // Check documentation in BondChainLinkOracle.sol on how to configure price feeds
            // Scenario 1
            const encodedOracleParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, uint48, address, uint48, uint8, bool)"],
                [[priceFeed1.address, "7200", ethers.constants.AddressZero, "0", "18", false]]
            ); // numeratorUpdateThreshold must be between 1 day and 1 week - 3600 and 604800 seconds

            // call setPair in oracle - quote, payout, supported, oracle params
            await oracle.setPair(quoteToken.address, payoutToken.address, true, encodedOracleParams);
        });
        it("should revert if the linear duration is less than the MIN_VESTING_DURATION", async () => {
            const hardhatTimestamp = (await ethers.provider.getBlock("latest")).timestamp; // in seconds
            vestingTimestamp = hardhatTimestamp + 5 * 60; // Set linear duration to start + 5 mins
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "20000",
                        "50000",
                        false,
                        ethers.utils.parseEther("10000"),
                        "36000",
                        "0",
                        "0",
                        bondDuration,
                        vestingTimestamp,
                        "0",
                    ],
                ]
            );
            // Call create market

            await expect(auctioner.createMarket(encodedParams)).to.be.revertedWithCustomError(auctioner, "Auctioneer_InvalidParams");
        });
        it("should create a fixed-expiry market, transfering the payout tokens ", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "20000",
                        "50000",
                        false,
                        ethers.utils.parseEther("10000"),
                        "36000",
                        "0",
                        "0",
                        bondDuration,
                        vestingTimestamp,
                        "0",
                    ],
                ]
            );
            // Call create market

            createTx = await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await payoutToken.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));

            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("520"));

            const createTimestamp = (await ethers.provider.getBlock(createTx.blockNumber)).timestamp;
            // Purchase bond
            const purchaseTx = await teller
                .connect(user1Signer)
                .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("520"), ethers.utils.parseEther("90"));
            const purchaseTimestamp = (await ethers.provider.getBlock(purchaseTx.blockNumber)).timestamp;
            const linearVestingDuration = vestingTimestamp - purchaseTimestamp;
            const receipt = await purchaseTx.wait();
            const bondedEvent = receipt.events?.find((x: any) => x.event === "Bonded");

            const vestingScheduleId = await vesting.getVestingIdAtIndex(0);
            let vestingSchedule = await vesting.getVestingSchedule(payoutToken.address, vestingScheduleId);

            expect(vestingSchedule.beneficiary).to.be.equal(user1Signer.address);
            expect(vestingSchedule.token).to.be.equal(payoutToken.address);
            expect(vestingSchedule.cliff).to.be.equal(purchaseTimestamp);
            expect(vestingSchedule.start).to.be.equal(purchaseTimestamp);
            expect(vestingSchedule.duration).to.be.equal(linearVestingDuration);
            expect(vestingSchedule.slicePeriodSeconds).to.be.equal(1);
            expect(vestingSchedule.amountTotal).to.be.equal(bondedEvent.args.payout);
        });
        it("should check linear duration is valid for a fixed-expiry linear vesting market", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "20000",
                        "50000",
                        false,
                        ethers.utils.parseEther("10000"),
                        "36000",
                        "0",
                        "0",
                        bondDuration,
                        "0",
                        "0",
                    ],
                ]
            );
            // Call create market
            await expect(auctioner.createMarket(encodedParams)).to.be.revertedWithCustomError(auctioner, "Auctioneer_InvalidParams");
        });
        it("should store linearDuration in bond terms", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "20000",
                        "50000",
                        false,
                        ethers.utils.parseEther("10000"),
                        "36000",
                        "0",
                        "0",
                        bondDuration,
                        vestingTimestamp,
                        "0",
                    ],
                ]
            );
            // Call create market
            createTx = await auctioner.createMarket(encodedParams);
            const bondTerms = await auctioner.terms(0);
            expect(bondTerms.linearDuration).to.be.equal(vestingTimestamp);
        });
    });
});
