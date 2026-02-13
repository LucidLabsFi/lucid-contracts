import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("MorphoYieldStrategy Tests", () => {
    const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
    const DEAD_SHARES_MIN = ethers.BigNumber.from("1000000000");
    const DEAD_SHARES_MIN_LOW_DECIMALS = ethers.BigNumber.from("1000000000000");

    let adminSigner: SignerWithAddress;
    let controllerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let recipientSigner: SignerWithAddress;
    let token: Contract;
    let vault: Contract;
    let strategy: Contract;
    let MorphoYieldStrategy: any;

    const deployTokenAndVault = async () => {
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

        const Vault = await ethers.getContractFactory("ERC4626Mock");
        vault = await Vault.deploy(token.address, "Mock Vault", "mVAULT");
    };

    const deployStrategy = async () => {
        MorphoYieldStrategy = await ethers.getContractFactory("MorphoYieldStrategy");
        strategy = await upgrades.deployProxy(MorphoYieldStrategy, [vault.address, token.address, controllerSigner.address, adminSigner.address], {
            initializer: "initialize",
        });
    };

    const seedDeadDeposit = async (amount: any, depositor?: SignerWithAddress) => {
        const depositorSigner = depositor || adminSigner;
        await token.connect(depositorSigner).approve(vault.address, amount);
        await vault.connect(depositorSigner).deposit(amount, DEAD_ADDRESS);
    };

    const donateYield = async (amount: any) => {
        await token.connect(adminSigner).transfer(vault.address, amount);
    };

    const getExpectedYield = async () => {
        const shares = await vault.balanceOf(strategy.address);
        const total = await vault.convertToAssets(shares);
        const principal = await strategy.getPrincipal();
        return total.gt(principal) ? total.sub(principal) : ethers.constants.Zero;
    };

    beforeEach(async () => {
        upgrades.silenceWarnings();
        [adminSigner, controllerSigner, user1Signer, recipientSigner] = await ethers.getSigners();
        await deployTokenAndVault();
    });

    describe("initialize", () => {
        beforeEach(async () => {
            MorphoYieldStrategy = await ethers.getContractFactory("MorphoYieldStrategy");
        });

        it("should initialize with correct parameters", async () => {
            strategy = await upgrades.deployProxy(
                MorphoYieldStrategy,
                [vault.address, token.address, controllerSigner.address, recipientSigner.address],
                {initializer: "initialize"}
            );

            expect(await strategy.vault()).to.equal(vault.address);
            expect(await strategy.underlyingAsset()).to.equal(token.address);
            expect(await strategy.controller()).to.equal(controllerSigner.address);
            expect(await strategy.hasRole(await strategy.DEFAULT_ADMIN_ROLE(), adminSigner.address)).to.be.false;
            expect(await strategy.hasRole(await strategy.DEFAULT_ADMIN_ROLE(), recipientSigner.address)).to.be.true;
        });

        it("should revert if vault is zero address", async () => {
            await expect(
                upgrades.deployProxy(
                    MorphoYieldStrategy,
                    [ethers.constants.AddressZero, token.address, controllerSigner.address, adminSigner.address],
                    {initializer: "initialize"}
                )
            ).to.be.revertedWithCustomError(MorphoYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if underlyingAsset is zero address", async () => {
            await expect(
                upgrades.deployProxy(
                    MorphoYieldStrategy,
                    [vault.address, ethers.constants.AddressZero, controllerSigner.address, adminSigner.address],
                    {initializer: "initialize"}
                )
            ).to.be.revertedWithCustomError(MorphoYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if assetController is zero address", async () => {
            await expect(
                upgrades.deployProxy(MorphoYieldStrategy, [vault.address, token.address, ethers.constants.AddressZero, adminSigner.address], {
                    initializer: "initialize",
                })
            ).to.be.revertedWithCustomError(MorphoYieldStrategy, "Strategy_ZeroAddress");
        });

        it("should revert if admin is zero address", async () => {
            await expect(
                upgrades.deployProxy(MorphoYieldStrategy, [vault.address, token.address, controllerSigner.address, ethers.constants.AddressZero], {
                    initializer: "initialize",
                })
            ).to.be.revertedWithCustomError(MorphoYieldStrategy, "Strategy_ZeroAddress");
        });
    });

    describe("deposit", () => {
        beforeEach(async () => {
            await deployStrategy();
        });

        it("should revert if dead deposit is missing", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await expect(strategy.connect(controllerSigner).deposit(depositAmount)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_DeadDepositMissing"
            );
        });

        it("should revert if amount is zero", async () => {
            await expect(strategy.connect(controllerSigner).deposit(0)).to.be.revertedWithCustomError(strategy, "Strategy_ZeroAmount");
        });

        describe("with dead deposit", () => {
            beforeEach(async () => {
                await seedDeadDeposit(DEAD_SHARES_MIN);
            });

            it("should deposit funds and mint shares", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await token.connect(controllerSigner).approve(strategy.address, depositAmount);

                const tx = await strategy.connect(controllerSigner).deposit(depositAmount);
                await expect(tx).to.emit(strategy, "Deposited").withArgs(depositAmount, depositAmount);

                expect(await strategy.getPrincipal()).to.equal(depositAmount);
                expect(await strategy.getTotalBalance()).to.equal(depositAmount);
                expect(await strategy.getYield()).to.equal(0);
                expect(await vault.balanceOf(strategy.address)).to.equal(depositAmount);
            });

            it("should revert if caller is not controller", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await token.connect(user1Signer).approve(strategy.address, depositAmount);
                await expect(strategy.connect(user1Signer).deposit(depositAmount)).to.be.revertedWithCustomError(strategy, "Strategy_OnlyController");
            });

            it("should allow multiple deposits and track principal correctly", async () => {
                const deposit1 = ethers.utils.parseEther("1000");
                const deposit2 = ethers.utils.parseEther("500");

                await token.connect(controllerSigner).approve(strategy.address, deposit1.add(deposit2));
                await strategy.connect(controllerSigner).deposit(deposit1);
                const tx = await strategy.connect(controllerSigner).deposit(deposit2);
                await expect(tx).to.emit(strategy, "Deposited").withArgs(deposit2, deposit1.add(deposit2));

                expect(await strategy.getPrincipal()).to.equal(deposit1.add(deposit2));
                expect(await strategy.getTotalBalance()).to.equal(deposit1.add(deposit2));
            });

            it("should revert if vault returns fewer shares than minted", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await vault.setBadDepositReturn(true);
                await token.connect(controllerSigner).approve(strategy.address, depositAmount);
                await expect(strategy.connect(controllerSigner).deposit(depositAmount)).to.be.revertedWithCustomError(
                    strategy,
                    "Strategy_DepositFailed"
                );
            });
        });
    });

    describe("withdraw", () => {
        const depositAmount = ethers.utils.parseEther("2000");

        beforeEach(async () => {
            await deployStrategy();
            await seedDeadDeposit(DEAD_SHARES_MIN);
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
            const tx = await strategy.connect(controllerSigner).withdraw(depositAmount);
            await expect(tx).to.emit(strategy, "PrincipalWithdrawn").withArgs(depositAmount, 0);

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
            await deployStrategy();
            await seedDeadDeposit(DEAD_SHARES_MIN);
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);
        });

        it("should withdraw yield successfully", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);
            const expectedYield = await getExpectedYield();

            const initialRecipientBalance = await token.balanceOf(recipientSigner.address);
            const tx = await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);
            await expect(tx).to.emit(strategy, "YieldWithdrawn").withArgs(expectedYield, recipientSigner.address);

            expect(await strategy.getYield()).to.equal(0);
            expect(await strategy.getPrincipal()).to.equal(depositAmount);
            expect(await token.balanceOf(recipientSigner.address)).to.equal(initialRecipientBalance.add(expectedYield));
        });

        it("should revert if recipient is zero address", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);

            await expect(strategy.connect(adminSigner).withdrawYield(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_ZeroAddress"
            );
        });

        it("should revert if caller is not admin", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);
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
            await donateYield(yieldAmount);
            const expectedYield = await getExpectedYield();

            const result = await strategy.connect(adminSigner).callStatic.withdrawYield(recipientSigner.address);
            expect(result).to.equal(expectedYield);
        });

        it("should withdraw multiple yield accumulations", async () => {
            const yield1 = ethers.utils.parseEther("50");
            await donateYield(yield1);
            const expectedYield1 = await getExpectedYield();
            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);

            const yield2 = ethers.utils.parseEther("75");
            await donateYield(yield2);
            const expectedYield2 = await getExpectedYield();
            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);

            expect(await token.balanceOf(recipientSigner.address)).to.equal(expectedYield1.add(expectedYield2));
            expect(await strategy.getPrincipal()).to.equal(depositAmount);
        });

        it("should handle yield withdrawal with no principal", async () => {
            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);

            await strategy.connect(controllerSigner).withdraw(depositAmount);
            expect(await strategy.getPrincipal()).to.equal(0);
            const remainingYield = await strategy.getTotalBalance();
            const recipientBefore = await token.balanceOf(recipientSigner.address);

            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);
            expect(await strategy.getTotalBalance()).to.equal(0);
            expect(await token.balanceOf(recipientSigner.address)).to.equal(recipientBefore.add(remainingYield));
        });
    });

    describe("getPrincipal", () => {
        beforeEach(async () => {
            await deployStrategy();
            await seedDeadDeposit(DEAD_SHARES_MIN);
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
            await donateYield(yieldAmount);

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
            await deployStrategy();
            await seedDeadDeposit(DEAD_SHARES_MIN);
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

        it("should increase when yield is generated", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);

            const totalBalance = await strategy.getTotalBalance();
            expect(totalBalance.gt(depositAmount)).to.be.true;
            expect(totalBalance.lte(depositAmount.add(yieldAmount))).to.be.true;
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
            await deployStrategy();
            await seedDeadDeposit(DEAD_SHARES_MIN);
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
            await donateYield(yieldAmount);

            const expectedYield = await getExpectedYield();
            expect(await strategy.getYield()).to.equal(expectedYield);
        });

        it("should accumulate multiple yield generations", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yield1 = ethers.utils.parseEther("50");
            await donateYield(yield1);
            const yield2 = ethers.utils.parseEther("75");
            await donateYield(yield2);

            const expectedYield = await getExpectedYield();
            expect(await strategy.getYield()).to.equal(expectedYield);
        });

        it("should return zero after withdrawing all yield", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);

            await strategy.connect(adminSigner).withdrawYield(recipientSigner.address);
            expect(await strategy.getYield()).to.equal(0);
        });

        it("should not be affected by principal withdrawal", async () => {
            const depositAmount = ethers.utils.parseEther("1000");
            await token.connect(controllerSigner).approve(strategy.address, depositAmount);
            await strategy.connect(controllerSigner).deposit(depositAmount);

            const yieldAmount = ethers.utils.parseEther("100");
            await donateYield(yieldAmount);
            const expectedYield = await getExpectedYield();

            const withdrawAmount = ethers.utils.parseEther("300");
            await strategy.connect(controllerSigner).withdraw(withdrawAmount);

            expect(await strategy.getYield()).to.equal(expectedYield);
        });
    });

    describe("asset", () => {
        beforeEach(async () => {
            await deployStrategy();
        });

        it("should return the correct underlying asset address", async () => {
            expect(await strategy.asset()).to.equal(token.address);
        });
    });

    describe("execute", () => {
        let callReceiver: Contract;

        beforeEach(async () => {
            await deployStrategy();
            const CallReceiver = await ethers.getContractFactory("CallReceiverMock");
            callReceiver = await CallReceiver.deploy();
        });

        it("should execute a call and return data", async () => {
            const payload = ethers.utils.toUtf8Bytes("hello");
            const data = callReceiver.interface.encodeFunctionData("ping", [payload]);
            const expectedReturn = callReceiver.interface.encodeFunctionResult("ping", [payload]);

            const result = await strategy.connect(adminSigner).callStatic.execute(callReceiver.address, data);
            expect(result).to.equal(expectedReturn);

            const tx = await strategy.connect(adminSigner).execute(callReceiver.address, data);
            await expect(tx).to.emit(strategy, "Executed").withArgs(callReceiver.address, 0, data, expectedReturn);
        });

        it("should revert if target is zero address", async () => {
            await expect(strategy.connect(adminSigner).execute(ethers.constants.AddressZero, "0x")).to.be.revertedWithCustomError(
                strategy,
                "Strategy_ZeroAddress"
            );
        });

        it("should revert if caller is not admin", async () => {
            const data = callReceiver.interface.encodeFunctionData("ping", ["0x"]);
            const defaultAdminRole = await strategy.DEFAULT_ADMIN_ROLE();

            await expect(strategy.connect(controllerSigner).execute(callReceiver.address, data)).to.be.revertedWith(
                `AccessControl: account ${controllerSigner.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should bubble revert reasons", async () => {
            const data = callReceiver.interface.encodeFunctionData("revertWithReason");
            await expect(strategy.connect(adminSigner).execute(callReceiver.address, data)).to.be.revertedWith("CallReceiverMock: revert");
        });

        it("should revert with Strategy_CallFailed on empty revert data", async () => {
            const data = callReceiver.interface.encodeFunctionData("revertNoReason");
            await expect(strategy.connect(adminSigner).execute(callReceiver.address, data)).to.be.revertedWithCustomError(
                strategy,
                "Strategy_CallFailed"
            );
        });
    });

    describe("rescueTokens", () => {
        let rescueToken: Contract;

        beforeEach(async () => {
            await deployStrategy();
            const Token = await ethers.getContractFactory("USDTMock");
            rescueToken = await Token.deploy("Rescue Token", "RSC");
            await rescueToken.mint(strategy.address, ethers.utils.parseEther("100"));
        });

        it("should allow admin to rescue tokens", async () => {
            const amount = ethers.utils.parseEther("10");
            const balanceBefore = await rescueToken.balanceOf(recipientSigner.address);
            await strategy.connect(adminSigner).rescueTokens(rescueToken.address, recipientSigner.address, amount);
            const balanceAfter = await rescueToken.balanceOf(recipientSigner.address);
            expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
        });

        it("should revert if not admin", async () => {
            const defaultAdminRole = await strategy.DEFAULT_ADMIN_ROLE();
            await expect(
                strategy.connect(user1Signer).rescueTokens(rescueToken.address, recipientSigner.address, ethers.utils.parseEther("1"))
            ).to.be.revertedWith(`AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`);
        });

        it("should revert if to is zero address", async () => {
            await expect(
                strategy.connect(adminSigner).rescueTokens(rescueToken.address, ethers.constants.AddressZero, ethers.utils.parseEther("1"))
            ).to.be.revertedWithCustomError(strategy, "Strategy_ZeroAddress");
        });
    });

    describe("rescueETH", () => {
        let callReceiver: Contract;

        beforeEach(async () => {
            await deployStrategy();
            const CallReceiver = await ethers.getContractFactory("CallReceiverMock");
            callReceiver = await CallReceiver.deploy();

            await adminSigner.sendTransaction({
                to: strategy.address,
                value: ethers.utils.parseEther("1"),
            });
        });

        it("should allow admin to rescue ETH", async () => {
            const amount = ethers.utils.parseEther("0.1");
            const balanceBefore = await ethers.provider.getBalance(recipientSigner.address);
            const tx = await strategy.connect(adminSigner).rescueETH(recipientSigner.address, amount);
            await tx.wait();
            const balanceAfter = await ethers.provider.getBalance(recipientSigner.address);
            expect(balanceAfter).to.equal(balanceBefore.add(amount));
        });

        it("should revert if not admin", async () => {
            const defaultAdminRole = await strategy.DEFAULT_ADMIN_ROLE();
            await expect(strategy.connect(user1Signer).rescueETH(recipientSigner.address, ethers.utils.parseEther("0.01"))).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should revert if to is zero address", async () => {
            await expect(
                strategy.connect(adminSigner).rescueETH(ethers.constants.AddressZero, ethers.utils.parseEther("0.01"))
            ).to.be.revertedWithCustomError(strategy, "Strategy_ZeroAddress");
        });

        it("should revert if ETH transfer fails", async () => {
            await callReceiver.setRejectEther(true);
            await expect(
                strategy.connect(adminSigner).rescueETH(callReceiver.address, ethers.utils.parseEther("0.01"))
            ).to.be.revertedWithCustomError(strategy, "Strategy_TransferFailed");
        });
    });

    describe("dead deposit low-decimals", () => {
        let usdc: Contract;
        let usdcVault: Contract;
        let usdcStrategy: Contract;

        beforeEach(async () => {
            const USDC = await ethers.getContractFactory("USDCMock");
            usdc = await USDC.deploy("USD Coin", "USDC", adminSigner.address);
            await usdc.mint(adminSigner.address, DEAD_SHARES_MIN_LOW_DECIMALS.mul(2));
            await usdc.mint(controllerSigner.address, ethers.utils.parseUnits("1000", 6));

            const Vault = await ethers.getContractFactory("ERC4626Mock");
            usdcVault = await Vault.deploy(usdc.address, "USDC Vault", "mUSDC");

            MorphoYieldStrategy = await ethers.getContractFactory("MorphoYieldStrategy");
            usdcStrategy = await upgrades.deployProxy(
                MorphoYieldStrategy,
                [usdcVault.address, usdc.address, controllerSigner.address, adminSigner.address],
                {initializer: "initialize"}
            );
        });

        it("should require dead deposit at low decimals", async () => {
            const depositAmount = ethers.utils.parseUnits("100", 6);
            await usdc.connect(controllerSigner).approve(usdcStrategy.address, depositAmount);
            await expect(usdcStrategy.connect(controllerSigner).deposit(depositAmount)).to.be.revertedWithCustomError(
                usdcStrategy,
                "Strategy_DeadDepositMissing"
            );
        });

        it("should allow deposit after seeding low-decimals dead deposit", async () => {
            await usdc.connect(adminSigner).approve(usdcVault.address, DEAD_SHARES_MIN_LOW_DECIMALS);
            await usdcVault.connect(adminSigner).deposit(DEAD_SHARES_MIN_LOW_DECIMALS, DEAD_ADDRESS);

            const depositAmount = ethers.utils.parseUnits("100", 6);
            await usdc.connect(controllerSigner).approve(usdcStrategy.address, depositAmount);
            await expect(usdcStrategy.connect(controllerSigner).deposit(depositAmount)).to.emit(usdcStrategy, "Deposited");
        });
    });
});
