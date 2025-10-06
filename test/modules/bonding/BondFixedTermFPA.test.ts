import {expect} from "chai";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("BondFixedTermFPA Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress; // collect protocol fees
    let feeRecipient: SignerWithAddress;

    let authority: Contract;
    let aggregator: Contract;
    let teller: Contract;
    let auctioner: Contract;
    let payoutToken: Contract;
    let quoteToken: Contract;
    let vesting: Contract;
    let vestingTimestamp: number;
    let bondDuration: number;
    let createTx: any;
    let vestingLength: number;

    beforeEach(async () => {
        const hardhatTimestamp = (await ethers.provider.getBlock("latest")).timestamp * 1000; // in milliseconds
        vestingLength = 86400; // 1 day in seconds

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
    describe("Create fixed-term market", () => {
        beforeEach(async () => {
            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedTermTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedTermFPA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should create a fixed-term market, transfering the payout tokens ", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, bool, uint256, uint256, uint48, uint48, uint48, uint48, uint48, int8)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        false,
                        ethers.utils.parseEther("100000"),
                        ethers.utils.parseEther("5000000000000000000"),
                        "3600",
                        vestingLength,
                        "0",
                        bondDuration,
                        "0",
                        "0",
                    ],
                ]
            ); // formated price in the simplest scenario (1:1) is 1 * 10**36, with 0 scale adjustment.
            // Call create market
            await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await payoutToken.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));

            //
            // Purchase bond
            //
            // Approve tokens
            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("520"));
            // Purchase bond
            const tx = await teller
                .connect(user1Signer)
                .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("520"), ethers.utils.parseEther("90"));
            // Get expiry and token id
            let receipt = await tx.wait();
            // Get tokenId from event during purchase
            let event = receipt.events?.filter((x: any) => {
                return x.event == "TransferSingle";
            });
            const tokenId = event[0].args["id"];

            //
            // Claim bond
            //
            // Jump in time in hardhat
            await helpers.time.increase(vestingLength * 2); // 1 more day after the position vests
            // Attach bond token - teller contract - and call balance of
            const bondTokenContract = await ethers.getContractAt("BondFixedTermTeller", teller.address);
            const balance = await bondTokenContract.balanceOf(user1Signer.address, tokenId);
            // Claim bond
            await teller.connect(user1Signer).redeem(tokenId, balance);

            expect(await payoutToken.balanceOf(user1Signer.address)).to.be.equal(balance); //Payout tokens should be transfered to the user 1:1
        });
    });
    describe("Fixed-term linear vesting bonds", () => {
        beforeEach(async () => {
            vestingLength = 86400; // 1 day in seconds
            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedTermTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedTermFPA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);
        });
        it("should revert if the linear duration is less than the MIN_VESTING_DURATION", async () => {
            vestingLength = 300; // 5 mins in seconds
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, bool, uint256, uint256, uint48, uint48, uint48, uint48, uint48, int8)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        false,
                        ethers.utils.parseEther("100000"),
                        ethers.utils.parseEther("5000000000000000000"),
                        "3600",
                        "0",
                        "0",
                        bondDuration,
                        vestingLength,
                        "0",
                    ],
                ]
            );
            // Call create market

            await expect(auctioner.createMarket(encodedParams)).to.be.revertedWithCustomError(auctioner, "Auctioneer_InvalidParams");
        });
        it("should create a vesting schedule with the correct params", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, bool, uint256, uint256, uint48, uint48, uint48, uint48, uint48, int8)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        false,
                        ethers.utils.parseEther("100000"),
                        ethers.utils.parseEther("5000000000000000000"),
                        "3600",
                        "0",
                        "0",
                        bondDuration,
                        vestingLength,
                        "0",
                    ],
                ]
            ); // formated price in the simplest scenario (1:1) is 1 * 10**36, with 0 scale adjustment.
            // Call create market

            createTx = await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await payoutToken.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));

            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("520"));

            const createTimestamp = (await ethers.provider.getBlock(createTx.blockNumber)).timestamp;
            const linearVestingDuration = vestingLength;
            // Purchase bond
            const purchaseTx = await teller
                .connect(user1Signer)
                .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("520"), ethers.utils.parseEther("90"));
            const purchaseTimestamp = (await ethers.provider.getBlock(purchaseTx.blockNumber)).timestamp;
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

            // Jump in time in hardhat & release
            // await helpers.time.increase(linearVestingDuration);
            // await vesting.connect(user1Signer).release(payoutToken.address, vestingScheduleId);
            // vestingSchedule = await vesting.getVestingSchedule(payoutToken.address, vestingScheduleId);
            // expect(vestingSchedule.released).to.be.equal(vestingSchedule.amountTotal);
        });
        it("should check linear duration is valid for a fixed-term linear vesting market", async () => {
            vestingLength = 60 * 60 * 24 * 365 * 51; // 51 years
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, bool, uint256, uint256, uint48, uint48, uint48, uint48, uint48, int8)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        false,
                        ethers.utils.parseEther("100000"),
                        ethers.utils.parseEther("5000000000000000000"),
                        "3600",
                        "0",
                        "0",
                        bondDuration,
                        vestingLength,
                        "0",
                    ],
                ]
            ); // formated price in the simplest scenario (1:1) is 1 * 10**36, with 0 scale adjustment.
            // Call create market
            await expect(auctioner.createMarket(encodedParams)).to.be.revertedWithCustomError(auctioner, "Auctioneer_InvalidParams");
        });
        it("should store linearDuration in bond terms", async () => {
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, bool, uint256, uint256, uint48, uint48, uint48, uint48, uint48, int8)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        false,
                        ethers.utils.parseEther("100000"),
                        ethers.utils.parseEther("5000000000000000000"),
                        "3600",
                        "0",
                        "0",
                        bondDuration,
                        vestingLength,
                        "0",
                    ],
                ]
            ); // formated price in the simplest scenario (1:1) is 1 * 10**36, with 0 scale adjustment.
            // Call create market
            createTx = await auctioner.createMarket(encodedParams);
            const bondTerms = await auctioner.terms(0);
            expect(bondTerms.linearDuration).to.be.equal(vestingLength);
        });
    });
});
