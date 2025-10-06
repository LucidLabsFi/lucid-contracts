import {expect} from "chai";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("FeeCollector Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let token: Contract;
    let feeCollector: Contract;

    beforeEach(async () => {
        [ownerSigner, user1Signer] = await ethers.getSigners();

        // Deploy token
        const Token = await ethers.getContractFactory("SimpleToken");
        token = await Token.deploy();
    });
    describe("constructor", () => {
        beforeEach(async () => {
            const FeeCollector = await ethers.getContractFactory("FeeCollector");
            feeCollector = await FeeCollector.deploy(500, user1Signer.address, ownerSigner.address);
        });
        it("should set feeBps and treasury", async () => {
            expect(await feeCollector.feeBps()).to.be.equal(500);
            expect(await feeCollector.treasury()).to.be.equal(user1Signer.address);
        });
    });
    describe("quote", () => {
        beforeEach(async () => {
            const FeeCollector = await ethers.getContractFactory("FeeCollector");
            feeCollector = await FeeCollector.deploy(500, user1Signer.address, ownerSigner.address);
        });
        it("should return the fee", async () => {
            const amount = ethers.utils.parseEther("100");
            const feeAmount = BigNumber.from(amount.mul(500).div(100000));
            const quote = await feeCollector.quote(amount);

            expect(quote).to.be.equal(feeAmount);
        });
        it("should return zero if no fee is set", async () => {
            // Set fee to 0
            await feeCollector.setFeeBps(0);
            const quote = await feeCollector.quote(ethers.utils.parseEther("100"));

            expect(quote).to.be.equal(0);
        });
    });
    describe("collect", () => {
        beforeEach(async () => {
            const FeeCollector = await ethers.getContractFactory("FeeCollector");
            feeCollector = await FeeCollector.deploy(500, user1Signer.address, ownerSigner.address);
        });
        it("should collect and redirect the fee to the treasury", async () => {
            const amount = ethers.utils.parseEther("100");
            const quote = await feeCollector.quote(amount);

            const balanceBefore = await token.balanceOf(user1Signer.address);
            await token.approve(feeCollector.address, quote);
            await feeCollector.collect(token.address, amount);
            const balanceAfter = await token.balanceOf(user1Signer.address);
            expect(balanceAfter.sub(balanceBefore)).to.be.equal(quote);
        });
        it("should not transfer tokens if quote is zero", async () => {
            // Set fee to 0
            await feeCollector.setFeeBps(0);
            const amount = ethers.utils.parseEther("100");

            const balanceBefore = await token.balanceOf(user1Signer.address);
            await token.approve(feeCollector.address, amount);
            await feeCollector.collect(token.address, amount);
            const balanceAfter = await token.balanceOf(user1Signer.address);
            expect(balanceAfter).to.be.equal(balanceBefore);
        });
        it("should revert if the fee is not approved", async () => {
            const amount = ethers.utils.parseEther("100");
            await expect(feeCollector.collect(token.address, amount)).to.be.revertedWith("ERC20: insufficient allowance");
        });
    });
    describe("setFeeBps", () => {
        beforeEach(async () => {
            const FeeCollector = await ethers.getContractFactory("FeeCollector");
            feeCollector = await FeeCollector.deploy(500, user1Signer.address, ownerSigner.address);
        });
        it("should set the fee", async () => {
            await feeCollector.setFeeBps(1000);
            expect(await feeCollector.feeBps()).to.be.equal(1000);
        });
        it("should revert if the fee is greater than MAX_FEE_BPS", async () => {
            const MAX_FEE_BPS = await feeCollector.MAX_FEE_BPS();
            await expect(feeCollector.setFeeBps(MAX_FEE_BPS.add(1))).to.be.revertedWithCustomError(feeCollector, "FeeCollector_FeeExceedsMaxBps");
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(feeCollector.connect(user1Signer).setFeeBps(1000)).to.be.revertedWithCustomError(feeCollector, "OwnableUnauthorizedAccount");
        });
    });
    describe("setTreasury", () => {
        beforeEach(async () => {
            const FeeCollector = await ethers.getContractFactory("FeeCollector");
            feeCollector = await FeeCollector.deploy(500, user1Signer.address, ownerSigner.address);
        });
        it("should set the treasury", async () => {
            await feeCollector.setTreasury(ownerSigner.address);
            expect(await feeCollector.treasury()).to.be.equal(ownerSigner.address);
        });
        it("should revert if the treasury is the zero address", async () => {
            await expect(feeCollector.setTreasury(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                feeCollector,
                "FeeCollector_TreasuryZeroAddress"
            );
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(feeCollector.connect(user1Signer).setTreasury(ownerSigner.address)).to.be.revertedWithCustomError(
                feeCollector,
                "OwnableUnauthorizedAccount"
            );
        });
    });
});
