import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("ControllerWrapper Tests", () => {
    let user1Signer: SignerWithAddress;
    let ownerSigner: SignerWithAddress;
    let user2Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let token: Contract;
    let acrossWrapper: Contract;
    let AcrossWrapper: any;

    // random address for spoke pool
    const spokePool = ethers.Wallet.createRandom().address;

    // NOTE 100_000 is 100%

    beforeEach(async () => {
        upgrades.silenceWarnings();
        [ownerSigner, user1Signer, user2Signer, treasurySigner] = await ethers.getSigners();

        // Deploy token
        const Token = await ethers.getContractFactory("XERC20Votes");
        token = await Token.deploy(
            "Test Token",
            "TEST",
            [ownerSigner.address, user1Signer.address],
            [ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000")],
            ownerSigner.address,
            ethers.constants.AddressZero,
            [],
            []
        );
        AcrossWrapper = await ethers.getContractFactory("AcrossV4Wrapper");
    });

    describe("constructor", () => {
        beforeEach(async () => {});

        it("should set the owner", async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
            expect(await acrossWrapper.owner()).to.equal(ownerSigner.address);
        });

        it("should set the treasury and feeRate", async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 1234);
            expect(await acrossWrapper.treasury()).to.equal(treasurySigner.address);
            expect(await acrossWrapper.feeRate()).to.equal(1234);
        });

        it("should revert if treasury is zero and feeRate > 0", async () => {
            await expect(AcrossWrapper.deploy(spokePool, ownerSigner.address, ethers.constants.AddressZero, 100)).to.be.revertedWithCustomError(
                AcrossWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });

        it("should revert if feeRate > MAX_FEE_RATE", async () => {
            await expect(AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 5001)).to.be.revertedWithCustomError(
                AcrossWrapper,
                "Wrapper_InvalidFeeRate"
            );
        });

        it("should revert if spokePool is zero address", async () => {
            await expect(
                AcrossWrapper.deploy(ethers.constants.AddressZero, ownerSigner.address, treasurySigner.address, 0)
            ).to.be.revertedWithCustomError(AcrossWrapper, "Wrapper_SpokePoolZeroAddress");
        });

        it("should emit TreasurySet and FeeRateSet events", async () => {
            expect(await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100))
                .to.emit(AcrossWrapper, "TreasurySet")
                .withArgs(ethers.constants.AddressZero, treasurySigner.address)
                .and.to.emit(AcrossWrapper, "FeeRateSet")
                .withArgs(0, 100);
        });
    });

    describe("setTreasury", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to set treasury", async () => {
            await expect(acrossWrapper.connect(ownerSigner).setTreasury(user2Signer.address))
                .to.emit(acrossWrapper, "TreasurySet")
                .withArgs(treasurySigner.address, user2Signer.address);
            expect(await acrossWrapper.treasury()).to.equal(user2Signer.address);
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).setTreasury(user2Signer.address))
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if newTreasury is zero address", async () => {
            await expect(acrossWrapper.connect(ownerSigner).setTreasury(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                acrossWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });
    });

    describe("setFeeRate", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to set feeRate", async () => {
            await expect(acrossWrapper.connect(ownerSigner).setFeeRate(1234)).to.emit(acrossWrapper, "FeeRateSet").withArgs(100, 1234);
            expect(await acrossWrapper.feeRate()).to.equal(1234);
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).setFeeRate(1234))
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if newRate > MAX_FEE_RATE", async () => {
            await expect(acrossWrapper.connect(ownerSigner).setFeeRate(5001)).to.be.revertedWithCustomError(acrossWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should revert if newRate > 0 and treasury is zero", async () => {
            // set treasury to zero first
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, ethers.constants.AddressZero, 0);
            await expect(acrossWrapper.connect(ownerSigner).setFeeRate(100)).to.be.revertedWithCustomError(
                acrossWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });
    });

    describe("pause", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to pause the contract", async () => {
            await expect(acrossWrapper.connect(ownerSigner).pause()).to.not.be.reverted;
            expect(await acrossWrapper.paused()).to.be.true;
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).pause())
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });
    });

    describe("unpause", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
            await acrossWrapper.connect(ownerSigner).pause();
        });

        it("should allow owner to unpause the contract", async () => {
            await expect(acrossWrapper.connect(ownerSigner).unpause()).to.not.be.reverted;
            expect(await acrossWrapper.paused()).to.be.false;
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).unpause())
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });
    });

    describe("rescueTokens", () => {
        let erc20: Contract;
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
            const Token = await ethers.getContractFactory("XERC20Votes");
            erc20 = await Token.deploy(
                "Test Token",
                "TEST",
                [ownerSigner.address],
                [ethers.utils.parseEther("10000")],
                ownerSigner.address,
                ethers.constants.AddressZero,
                [],
                []
            );
            await erc20.connect(ownerSigner).transfer(acrossWrapper.address, ethers.utils.parseEther("100"));
        });

        it("should allow owner to rescue tokens", async () => {
            const to = user1Signer.address;
            const amount = ethers.utils.parseEther("10");
            await expect(acrossWrapper.connect(ownerSigner).rescueTokens(erc20.address, to, amount)).to.not.be.reverted;
            expect(await erc20.balanceOf(to)).to.equal(amount);
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).rescueTokens(erc20.address, user2Signer.address, 1))
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if to is zero address", async () => {
            await expect(
                acrossWrapper.connect(ownerSigner).rescueTokens(erc20.address, ethers.constants.AddressZero, 1)
            ).to.be.revertedWithCustomError(acrossWrapper, "Wrapper_ZeroAddress");
        });
    });

    describe("rescueETH", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 100);
            // Send ETH to contract
            await ownerSigner.sendTransaction({to: acrossWrapper.address, value: ethers.utils.parseEther("1")});
        });

        it("should allow owner to rescue ETH", async () => {
            const to = user1Signer.address;
            const amount = ethers.utils.parseEther("0.1");
            const before = await ethers.provider.getBalance(to);
            await expect(acrossWrapper.connect(ownerSigner).rescueETH(to, amount)).to.not.be.reverted;
            const after = await ethers.provider.getBalance(to);
            expect(after.sub(before)).to.equal(amount);
        });

        it("should revert if not owner", async () => {
            await expect(acrossWrapper.connect(user1Signer).rescueETH(user2Signer.address, 1))
                .to.be.revertedWithCustomError(acrossWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if to is zero address", async () => {
            await expect(acrossWrapper.connect(ownerSigner).rescueETH(ethers.constants.AddressZero, 1)).to.be.revertedWithCustomError(
                acrossWrapper,
                "Wrapper_ZeroAddress"
            );
        });
    });

    describe("quote", () => {
        beforeEach(async () => {
            acrossWrapper = await AcrossWrapper.deploy(spokePool, ownerSigner.address, treasurySigner.address, 1000); // 1%
        });

        it("should return correct fee and net", async () => {
            const amount = ethers.utils.parseEther("10");
            const [fee, net] = await acrossWrapper.quote(amount);
            expect(fee).to.equal(amount.mul(1000).div(100_000));
            expect(net).to.equal(amount.sub(fee));
        });

        it("should return 0 fee if amount is 0", async () => {
            const [fee, net] = await acrossWrapper.quote(0);
            expect(fee).to.equal(0);
            expect(net).to.equal(0);
        });

        it("should return 0 fee if feeRate is 0", async () => {
            await acrossWrapper.connect(ownerSigner).setFeeRate(0);
            const amount = ethers.utils.parseEther("10");
            const [fee, net] = await acrossWrapper.quote(amount);
            expect(fee).to.equal(0);
            expect(net).to.equal(amount);
        });
    });
});
