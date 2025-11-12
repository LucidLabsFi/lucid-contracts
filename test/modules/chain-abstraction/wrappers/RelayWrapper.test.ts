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
    let relayDepositoryMock: Contract;
    let relayWrapper: Contract;
    let RelayWrapper: any;
    let id: string;

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
        const RelayDepositoryMock = await ethers.getContractFactory("RelayDepositoryMock");
        relayDepositoryMock = await RelayDepositoryMock.deploy();

        RelayWrapper = await ethers.getContractFactory("RelayWrapper");
    });

    describe("constructor", () => {
        beforeEach(async () => {});

        it("should set the owner", async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
            expect(await relayWrapper.owner()).to.equal(ownerSigner.address);
        });

        it("should set the treasury and feeRate", async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 1234);
            expect(await relayWrapper.treasury()).to.equal(treasurySigner.address);
            expect(await relayWrapper.feeRate()).to.equal(1234);
        });

        it("should revert if treasury is zero and feeRate > 0", async () => {
            await expect(
                RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, ethers.constants.AddressZero, 100)
            ).to.be.revertedWithCustomError(RelayWrapper, "Wrapper_TreasuryZeroAddress");
        });

        it("should revert if feeRate > MAX_FEE_RATE", async () => {
            await expect(
                RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 5001)
            ).to.be.revertedWithCustomError(RelayWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should revert if relay depository is zero address", async () => {
            await expect(
                RelayWrapper.deploy(ethers.constants.AddressZero, ownerSigner.address, treasurySigner.address, 0)
            ).to.be.revertedWithCustomError(RelayWrapper, "Wrapper_RelayDepositoryZeroAddress");
        });

        it("should emit TreasurySet and FeeRateSet events", async () => {
            expect(await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100))
                .to.emit(RelayWrapper, "TreasurySet")
                .withArgs(ethers.constants.AddressZero, treasurySigner.address)
                .and.to.emit(RelayWrapper, "FeeRateSet")
                .withArgs(0, 100);
        });
    });

    describe("setTreasury", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to set treasury", async () => {
            await expect(relayWrapper.connect(ownerSigner).setTreasury(user2Signer.address))
                .to.emit(relayWrapper, "TreasurySet")
                .withArgs(treasurySigner.address, user2Signer.address);
            expect(await relayWrapper.treasury()).to.equal(user2Signer.address);
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).setTreasury(user2Signer.address))
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if newTreasury is zero address", async () => {
            await expect(relayWrapper.connect(ownerSigner).setTreasury(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });
    });

    describe("setFeeRate", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to set feeRate", async () => {
            await expect(relayWrapper.connect(ownerSigner).setFeeRate(1234)).to.emit(relayWrapper, "FeeRateSet").withArgs(100, 1234);
            expect(await relayWrapper.feeRate()).to.equal(1234);
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).setFeeRate(1234))
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if newRate > MAX_FEE_RATE", async () => {
            await expect(relayWrapper.connect(ownerSigner).setFeeRate(5001)).to.be.revertedWithCustomError(relayWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should revert if newRate > 0 and treasury is zero", async () => {
            // set treasury to zero first
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, ethers.constants.AddressZero, 0);
            await expect(relayWrapper.connect(ownerSigner).setFeeRate(100)).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });
    });

    describe("pause", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
        });

        it("should allow owner to pause the contract", async () => {
            await expect(relayWrapper.connect(ownerSigner).pause()).to.not.be.reverted;
            expect(await relayWrapper.paused()).to.be.true;
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).pause())
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });
    });

    describe("unpause", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
            await relayWrapper.connect(ownerSigner).pause();
        });

        it("should allow owner to unpause the contract", async () => {
            await expect(relayWrapper.connect(ownerSigner).unpause()).to.not.be.reverted;
            expect(await relayWrapper.paused()).to.be.false;
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).unpause())
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });
    });

    describe("rescueTokens", () => {
        let erc20: Contract;
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
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
            await erc20.connect(ownerSigner).transfer(relayWrapper.address, ethers.utils.parseEther("100"));
        });

        it("should allow owner to rescue tokens", async () => {
            const to = user1Signer.address;
            const amount = ethers.utils.parseEther("10");
            await expect(relayWrapper.connect(ownerSigner).rescueTokens(erc20.address, to, amount)).to.not.be.reverted;
            expect(await erc20.balanceOf(to)).to.equal(amount);
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).rescueTokens(erc20.address, user2Signer.address, 1))
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if to is zero address", async () => {
            await expect(
                relayWrapper.connect(ownerSigner).rescueTokens(erc20.address, ethers.constants.AddressZero, 1)
            ).to.be.revertedWithCustomError(relayWrapper, "Wrapper_ZeroAddress");
        });
    });

    describe("rescueETH", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 100);
            // Send ETH to contract
            await ownerSigner.sendTransaction({to: relayWrapper.address, value: ethers.utils.parseEther("1")});
        });

        it("should allow owner to rescue ETH", async () => {
            const to = user1Signer.address;
            const amount = ethers.utils.parseEther("0.1");
            const before = await ethers.provider.getBalance(to);
            await expect(relayWrapper.connect(ownerSigner).rescueETH(to, amount)).to.not.be.reverted;
            const after = await ethers.provider.getBalance(to);
            expect(after.sub(before)).to.equal(amount);
        });

        it("should revert if not owner", async () => {
            await expect(relayWrapper.connect(user1Signer).rescueETH(user2Signer.address, 1))
                .to.be.revertedWithCustomError(relayWrapper, "OwnableUnauthorizedAccount")
                .withArgs(user1Signer.address);
        });

        it("should revert if to is zero address", async () => {
            await expect(relayWrapper.connect(ownerSigner).rescueETH(ethers.constants.AddressZero, 1)).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_ZeroAddress"
            );
        });
    });

    describe("quote", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 1000); // 1%
        });

        it("should return correct fee and net", async () => {
            const amount = ethers.utils.parseEther("10");
            const [fee, net] = await relayWrapper.quote(amount);
            expect(fee).to.equal(amount.mul(1000).div(100_000));
            expect(net).to.equal(amount.sub(fee));
        });

        it("should return 0 fee if amount is 0", async () => {
            const [fee, net] = await relayWrapper.quote(0);
            expect(fee).to.equal(0);
            expect(net).to.equal(0);
        });

        it("should return 0 fee if feeRate is 0", async () => {
            await relayWrapper.connect(ownerSigner).setFeeRate(0);
            const amount = ethers.utils.parseEther("10");
            const [fee, net] = await relayWrapper.quote(amount);
            expect(fee).to.equal(0);
            expect(net).to.equal(amount);
        });
    });

    describe("depositErc20", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 1000); // 1%
            id = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        });

        it("should deposit ERC20, take fee, and emit events", async () => {
            const amount = ethers.utils.parseEther("100");
            const fee = amount.mul(1000).div(100_000);
            const net = amount.sub(fee);
            await token.connect(user1Signer).approve(relayWrapper.address, amount);

            // Listen for TransferSent event
            await expect(relayWrapper.connect(user1Signer).depositErc20(token.address, amount, id, "0x1234"))
                .to.emit(relayWrapper, "TransferSent")
                .withArgs(user1Signer.address, token.address, id, net, "0x1234");

            // Fee should be sent to treasury
            expect(await token.balanceOf(treasurySigner.address)).to.equal(fee);
            // Net should be sent to relayDepositoryMock
            expect(await token.balanceOf(relayDepositoryMock.address)).to.equal(net);
        });

        it("should revert if msg.value != 0", async () => {
            await token.connect(user1Signer).approve(relayWrapper.address, 1);
            await expect(relayWrapper.connect(user1Signer).depositErc20(token.address, 1, id, "0x1234", {value: 1})).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_MsgValueNotZero"
            );
        });

        it("should revert if amount == 0", async () => {
            await expect(relayWrapper.connect(user1Signer).depositErc20(token.address, 0, id, "0x1234")).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_AmountZero"
            );
        });

        it("should revert if paused", async () => {
            await relayWrapper.connect(ownerSigner).pause();
            await token.connect(user1Signer).approve(relayWrapper.address, 1);
            await expect(relayWrapper.connect(user1Signer).depositErc20(token.address, 1, id, "0x1234")).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("depositNative", () => {
        beforeEach(async () => {
            relayWrapper = await RelayWrapper.deploy(relayDepositoryMock.address, ownerSigner.address, treasurySigner.address, 2000); // 2%
            id = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        });

        it("should deposit native ETH, take fee, and emit events", async () => {
            const amount = ethers.utils.parseEther("1");
            const fee = amount.mul(2000).div(100_000);
            const net = amount.sub(fee);
            const treasuryBefore = await ethers.provider.getBalance(treasurySigner.address);

            // Listen for TransferSent event
            await expect(relayWrapper.connect(user1Signer).depositNative(id, "0x5678", {value: amount}))
                .to.emit(relayWrapper, "TransferSent")
                .withArgs(user1Signer.address, ethers.constants.AddressZero, id, net, "0x5678");

            // Fee should be sent to treasury
            const treasuryAfter = await ethers.provider.getBalance(treasurySigner.address);
            expect(treasuryAfter.sub(treasuryBefore)).to.equal(fee);
        });

        it("should revert if msg.value == 0", async () => {
            await expect(relayWrapper.connect(user1Signer).depositNative(id, "0x5678", {value: 0})).to.be.revertedWithCustomError(
                relayWrapper,
                "Wrapper_AmountZero"
            );
        });

        it("should revert if paused", async () => {
            await relayWrapper.connect(ownerSigner).pause();
            await expect(relayWrapper.connect(user1Signer).depositNative(id, "0x5678", {value: 1})).to.be.revertedWith("Pausable: paused");
        });
    });
});
