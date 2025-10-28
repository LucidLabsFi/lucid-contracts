import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("AaveYieldStrategy Tests", () => {
    let adminSigner: SignerWithAddress;
    let controllerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let recipientSigner: SignerWithAddress;
    let token: Contract;
    let aavePoolMock: Contract;
    let strategy: Contract;
    let AaveYieldStrategy: any;

    beforeEach(async () => {
        upgrades.silenceWarnings();
        [adminSigner, controllerSigner, user1Signer, recipientSigner] = await ethers.getSigners();

        // Deploy underlying token
        const Token = await ethers.getContractFactory("XERC20Votes");
        token = await Token.deploy(
            "Test Token",
            "TEST",
            [adminSigner.address, controllerSigner.address],
            [ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")],
            adminSigner.address,
            ethers.constants.AddressZero,
            [],
            []
        );

        // Deploy AavePoolMock (which acts as both pool and aToken)
        const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
        aavePoolMock = await AavePoolMock.deploy(adminSigner.address, token.address, "Aave Test Token", "aTEST");
    });

    describe("initialize", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
        });

        it("should initialize with correct parameters", async () => {
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );

            expect(await strategy.aavePool()).to.equal(aavePoolMock.address);
            expect(await strategy.underlyingAsset()).to.equal(token.address);
            expect(await strategy.controller()).to.equal(controllerSigner.address);
            expect(await strategy.aToken()).to.equal(aavePoolMock.address); // Mock is both pool and aToken
            expect(await strategy.hasRole(await strategy.DEFAULT_ADMIN_ROLE(), adminSigner.address)).to.be.true;
        });

        it("should revert if aavePool is zero address", async () => {
            await expect(
                upgrades.deployProxy(
                    AaveYieldStrategy,
                    [ethers.constants.AddressZero, token.address, controllerSigner.address, adminSigner.address],
                    {
                        initializer: "initialize",
                    }
                )
            ).to.be.revertedWithCustomError(AaveYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if underlyingAsset is zero address", async () => {
            await expect(
                upgrades.deployProxy(
                    AaveYieldStrategy,
                    [aavePoolMock.address, ethers.constants.AddressZero, controllerSigner.address, adminSigner.address],
                    {
                        initializer: "initialize",
                    }
                )
            ).to.be.revertedWithCustomError(AaveYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if assetController is zero address", async () => {
            await expect(
                upgrades.deployProxy(AaveYieldStrategy, [aavePoolMock.address, token.address, ethers.constants.AddressZero, adminSigner.address], {
                    initializer: "initialize",
                })
            ).to.be.revertedWithCustomError(AaveYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if admin is zero address", async () => {
            await expect(
                upgrades.deployProxy(
                    AaveYieldStrategy,
                    [aavePoolMock.address, token.address, controllerSigner.address, ethers.constants.AddressZero],
                    {
                        initializer: "initialize",
                    }
                )
            ).to.be.revertedWithCustomError(AaveYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if underlying asset is not supported by Aave pool", async () => {
            // Deploy a different token that's not supported
            const Token2 = await ethers.getContractFactory("XERC20Votes");
            const token2 = await Token2.deploy(
                "Test Token 2",
                "TEST2",
                [adminSigner.address],
                [ethers.utils.parseEther("10000")],
                adminSigner.address,
                ethers.constants.AddressZero,
                [],
                []
            );

            await expect(
                upgrades.deployProxy(AaveYieldStrategy, [aavePoolMock.address, token2.address, controllerSigner.address, adminSigner.address], {
                    initializer: "initialize",
                })
            ).to.be.revertedWithCustomError(AaveYieldStrategy, "Strategy_UnderlyingNotSupported");
        });
    });

    describe("deposit", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );
        });

        it("should deposit funds and mint aTokens", async () => {
            const depositAmount = ethers.utils.parseEther("1000");

            // Approve strategy to spend tokens
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);

            // Deposit
            const tx = await strategy.connect(controllerSigner).deposit(depositAmount);
            await expect(tx).to.emit(strategy, "Deposited").withArgs(depositAmount, depositAmount);

            // Check balances
            expect(await strategy.getPrincipal()).to.equal(depositAmount);
            expect(await strategy.getTotalBalance()).to.equal(depositAmount);
            expect(await strategy.getYield()).to.equal(0);
            expect(await aavePoolMock.balanceOf(strategy.address)).to.equal(depositAmount);
        });

        it("should revert if amount is zero", async () => {
            await expect(strategy.connect(controllerSigner).deposit(0)).to.be.revertedWithCustomError(strategy, "Strategy_ZeroAmount");
        });

        it("should revert if caller is not controller", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await expect(strategy.connect(user1Signer).deposit(depositAmount)).to.be.revertedWithCustomError(strategy, "Strategy_OnlyController");
        });

        it("should allow multiple deposits and track principal correctly", async () => {
            const deposit1 = ethers.utils.parseEther("1000");
            const deposit2 = ethers.utils.parseEther("500");

            await token.connect(controllerSigner).approve(strategy.address, deposit1.add(deposit2));

            await strategy.connect(controllerSigner).deposit(deposit1);
            await strategy.connect(controllerSigner).deposit(deposit2);

            expect(await strategy.getPrincipal()).to.equal(deposit1.add(deposit2));
            expect(await strategy.getTotalBalance()).to.equal(deposit1.add(deposit2));
        });
    });

    describe("withdraw", () => {
        const depositAmount = ethers.utils.parseEther("2000");

        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );

            // Make initial deposit
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);
        });

        it("should withdraw principal successfully", async () => {
            const withdrawAmount = ethers.utils.parseEther("500");
            const initialControllerBalance = await token.balanceOf(controllerSigner.address);

            const tx = await strategy.connect(controllerSigner).withdraw(withdrawAmount);
            await expect(tx).to.emit(strategy, "PrincipalWithdrawn").withArgs(withdrawAmount, depositAmount.sub(withdrawAmount));

            expect(await strategy.getPrincipal()).to.equal(depositAmount.sub(withdrawAmount));
            expect(await token.balanceOf(controllerSigner.address)).to.equal(initialControllerBalance.add(withdrawAmount));
        });

        it("should revert if amount is zero", async () => {
            await expect(strategy.connect(controllerSigner).withdraw(0)).to.be.revertedWithCustomError(strategy, "Strategy_ZeroAmount");
        });

        it("should revert if caller is not controller", async () => {
            const withdrawAmount = ethers.utils.parseEther("500");
            await expect(strategy.connect(user1Signer).withdraw(withdrawAmount)).to.be.revertedWithCustomError(strategy, "Strategy_OnlyController");
        });

        it("should revert if amount exceeds principal", async () => {
            const withdrawAmount = depositAmount.add(1);
            await expect(strategy.connect(controllerSigner).withdraw(withdrawAmount)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_InsufficientPrincipal"
            );
        });

        it("should allow withdrawing all principal", async () => {
            await strategy.connect(controllerSigner).withdraw(depositAmount);

            expect(await strategy.getPrincipal()).to.equal(0);
            expect(await strategy.getTotalBalance()).to.equal(0);
        });

        it("should return the withdrawn amount", async () => {
            const withdrawAmount = ethers.utils.parseEther("500");
            const result = await strategy.connect(controllerSigner).callStatic.withdraw(withdrawAmount);
            expect(result).to.equal(withdrawAmount);
        });

        it("should handle multiple partial withdrawals", async () => {
            const withdraw1 = ethers.utils.parseEther("500");
            const withdraw2 = ethers.utils.parseEther("300");

            await strategy.connect(controllerSigner).withdraw(withdraw1);
            await strategy.connect(controllerSigner).withdraw(withdraw2);

            expect(await strategy.getPrincipal()).to.equal(depositAmount.sub(withdraw1).sub(withdraw2));
        });
    });

    describe("withdrawYield", () => {
        const depositAmount = ethers.utils.parseEther("2000");

        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );

            // Make initial deposit
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);
        });

        it("should withdraw yield successfully", async () => {
            // Simulate yield generation
            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            const initialRecipientBalance = await token.balanceOf(recipientSigner.address);

            const tx = await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);
            await expect(tx).to.emit(strategy, "YieldWithdrawn").withArgs(yieldAmount, recipientSigner.address);

            expect(await strategy.getYield()).to.equal(0);
            expect(await strategy.getPrincipal()).to.equal(depositAmount);
            expect(await token.balanceOf(recipientSigner.address)).to.equal(initialRecipientBalance.add(yieldAmount));
        });

        it("should revert if recipient is zero address", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            await expect(strategy.connect(adminSigner).withdrawYield(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_ZeroAddress"
            );
        });

        it("should revert if caller is not admin", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);
            const defaultAdminRole = await strategy.DEFAULT_ADMIN_ROLE();

            await expect(strategy.connect(controllerSigner).withdrawYield(recipientSigner.address)).to.be.revertedWith(
                `AccessControl: account ${controllerSigner.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should revert if there is no yield", async () => {
            await expect(strategy.connect(adminSigner).withdrawYield(recipientSigner.address)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_InsufficientYield"
            );
        });

        it("should return the withdrawn yield amount", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            const result = await strategy.connect(adminSigner).callStatic.withdrawYield(recipientSigner.address);
            expect(result).to.equal(yieldAmount);
        });

        it("should withdraw multiple yield accumulations", async () => {
            // First yield generation
            const yield1 = ethers.utils.parseEther("50");
            await aavePoolMock.simulateYield(strategy.address, yield1);
            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);

            // Second yield generation
            const yield2 = ethers.utils.parseEther("75");
            await aavePoolMock.simulateYield(strategy.address, yield2);
            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);

            expect(await token.balanceOf(recipientSigner.address)).to.equal(yield1.add(yield2));
            expect(await strategy.getPrincipal()).to.equal(depositAmount);
        });

        it("should handle yield withdrawal with no principal", async () => {
            // Simulate yield on remaining balance (edge case)
            const yieldAmount = ethers.utils.parseEther("10");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            // Withdraw all principal first
            await strategy.connect(controllerSigner).withdraw(depositAmount);
            expect(await strategy.getPrincipal()).to.equal(0);
            expect(await strategy.getTotalBalance()).to.equal(yieldAmount);

            // Transfer tokens to the pool so it can pay out the yield
            await token.connect(adminSigner).transfer(aavePoolMock.address, yieldAmount.mul(2));

            // Should withdraw all remaining balance
            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);
            expect(await strategy.getTotalBalance()).to.equal(0);
        });
    });

    describe("getPrincipal", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );
        });

        it("should return zero initially", async () => {
            expect(await strategy.getPrincipal()).to.equal(0);
        });

        it("should return correct principal after deposit", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            expect(await strategy.getPrincipal()).to.equal(depositAmount);
        });

        it("should not change when yield is generated", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            expect(await strategy.getPrincipal()).to.equal(depositAmount);
        });

        it("should decrease when principal is withdrawn", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const withdrawAmount = ethers.utils.parseEther("300");
            await strategy.connect(controllerSigner).withdraw(withdrawAmount);

            expect(await strategy.getPrincipal()).to.equal(depositAmount.sub(withdrawAmount));
        });
    });

    describe("getTotalBalance", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );
        });

        it("should return zero initially", async () => {
            expect(await strategy.getTotalBalance()).to.equal(0);
        });

        it("should return correct balance after deposit", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            expect(await strategy.getTotalBalance()).to.equal(depositAmount);
        });

        it("should decrease when principal is withdrawn", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const withdrawAmount = ethers.utils.parseEther("300");
            await strategy.connect(controllerSigner).withdraw(withdrawAmount);

            expect(await strategy.getTotalBalance()).to.equal(depositAmount.sub(withdrawAmount));
        });
    });

    describe("getYield", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );
        });

        it("should return zero initially", async () => {
            expect(await strategy.getYield()).to.equal(0);
        });

        it("should return zero after deposit without yield", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            expect(await strategy.getYield()).to.equal(0);
        });

        it("should return correct yield amount", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            expect(await strategy.getYield()).to.equal(yieldAmount);
        });

        it("should accumulate multiple yield generations", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yield1 = ethers.utils.parseEther("50");
            await aavePoolMock.simulateYield(strategy.address, yield1);

            const yield2 = ethers.utils.parseEther("75");
            await aavePoolMock.simulateYield(strategy.address, yield2);

            expect(await strategy.getYield()).to.equal(yield1.add(yield2));
        });

        it("should return zero after withdrawing all yield", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);

            expect(await strategy.getYield()).to.equal(0);
        });

        it("should not be affected by principal withdrawal", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await aavePoolMock.simulateYield(strategy.address, yieldAmount);

            const withdrawAmount = ethers.utils.parseEther("300");
            await strategy.connect(controllerSigner).withdraw(withdrawAmount);

            expect(await strategy.getYield()).to.equal(yieldAmount);
        });
    });

    describe("asset", () => {
        beforeEach(async () => {
            AaveYieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");
            strategy = await upgrades.deployProxy(
                AaveYieldStrategy,
                [aavePoolMock.address, token.address, controllerSigner.address, adminSigner.address],
                {
                    initializer: "initialize",
                }
            );
        });

        it("should return the correct underlying asset address", async () => {
            expect(await strategy.asset()).to.equal(token.address);
        });
    });
});
