import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("LockReleaseAssetController Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasury: SignerWithAddress;
    let pauser: SignerWithAddress;
    let yieldManager: SignerWithAddress;
    let treasuryAddress: string;
    let sourceToken: Contract;
    let destToken: Contract;
    let nativeToken: Contract;
    let feeCollector: Contract;
    let sourceController: Contract;
    let destController: Contract;
    let connext: Contract;
    let relayerFee: BigNumber;
    let sourceBridgeAdapter: Contract;
    let destBridgeAdapter: Contract;
    let amountToBridge: any;
    let transferId: string;
    let bridgeOptions: any;
    let strategy: Contract;
    let aavePoolMock: Contract;
    let YieldStrategy: any;

    const protocolFee = 5000;
    const multiBridgeFee = 500; // 0.5%
    const relayerFeeThreshold = ethers.utils.parseEther("0.0001");
    const minBridges = 2;
    const bridgeGasLimit = 2000000;

    const replenishDuration = 43200; // 12 hours
    beforeEach(async () => {
        upgrades.silenceWarnings();
        [ownerSigner, user1Signer, treasury, pauser, yieldManager] = await ethers.getSigners();
        treasuryAddress = treasury.address;

        // Chain 50 - sourceController, BridgeAdapter
        // Chain 100 - destController, BridgeAdapter

        YieldStrategy = await ethers.getContractFactory("AaveYieldStrategy");

        // Deploy Native Token
        const Token = await ethers.getContractFactory("USDTMock");
        sourceToken = await Token.deploy("USDT Mock", "USDT");

        // // Deploy XERC20 Token
        const XERC20 = await ethers.getContractFactory("XERC20Votes");
        destToken = await XERC20.deploy(
            "Dest Token",
            "DST",
            [ownerSigner.address],
            [ethers.utils.parseEther("100000")],
            ownerSigner.address,
            treasury.address,
            [ethers.utils.parseEther("5"), ethers.utils.parseEther("500")],
            [100, 200]
        );

        // Deploy Mock connext contract
        const Connext = await ethers.getContractFactory("ConnextMock");
        connext = await Connext.deploy();

        // Deploy FeeCollector contract
        const FeeCollector = await ethers.getContractFactory("FeeCollector");
        feeCollector = await FeeCollector.deploy(multiBridgeFee, treasuryAddress, ownerSigner.address);

        // Deploy AssetController contract
        const LockReleaseAssetController = await ethers.getContractFactory("LockReleaseAssetController");
        sourceController = await LockReleaseAssetController.deploy(
            [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
            replenishDuration,
            minBridges,
            [],
            [],
            [],
            [],
            [],
            ["0x00000000", "0x00000000"],
            ethers.constants.AddressZero
        );

        // Deploy Destination AssetController contract
        const AssetController = await ethers.getContractFactory("AssetController");

        destController = await AssetController.deploy(
            [destToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
            replenishDuration,
            minBridges,
            [],
            [],
            [],
            [],
            [],
            ["0x40c10f19", "0x9dc29fac"]
        );

        // Set Bridge limits for Asset Controller in XERC20
        // await sourceToken.setLimits(sourceController.address, ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000"));
        await destToken.setLimits(destController.address, ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000"));

        // Deploy Source Bridge Adapter (Connext)
        const BridgeAdapter = await ethers.getContractFactory("ConnextAdapter");
        sourceBridgeAdapter = await BridgeAdapter.deploy(
            connext.address,
            "Connext Adapter",
            relayerFeeThreshold,
            treasuryAddress,
            protocolFee,
            [100],
            [1000],
            ownerSigner.address
        );

        // Deploy Bridge Adapter (Connext)
        destBridgeAdapter = await BridgeAdapter.deploy(
            connext.address,
            "Connext Adapter",
            relayerFeeThreshold,
            treasuryAddress,
            protocolFee,
            [50],
            [500],
            ownerSigner.address
        );

        // After bridge addapters' address is known, set it in the other adapter contract
        await sourceBridgeAdapter.setTrustedAdapter(100, destBridgeAdapter.address);
        await destBridgeAdapter.setTrustedAdapter(50, sourceBridgeAdapter.address);

        // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
        await sourceController.setControllerForChain([100], [destController.address]);
        await destController.setControllerForChain([50], [sourceController.address]);

        // Set bridge limits
        await sourceController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(destBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set bridge limits for whitelisted multiBridge adapters
        await sourceController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set domain Id for adapter contract, applycable to Connext adapters
        await sourceBridgeAdapter.setDomainId([50], [500]);
        await destBridgeAdapter.setDomainId([100], [1000]);
        await sourceBridgeAdapter.setDomainId([100], [1000]);
        await destBridgeAdapter.setDomainId([50], [500]);

        // set origin domain id in Mock Connext contract
        await connext.setOriginDomainId(sourceBridgeAdapter.address, 500); // domain id of the same chain of source adapter
        await connext.setOriginDomainId(destBridgeAdapter.address, 1000); // domain id of the same chain of dest adapter

        // Set unlimited controllers in AssetController
        await sourceController.setMultiBridgeAdapters([sourceBridgeAdapter.address], [true]);
        await destController.setMultiBridgeAdapters([destBridgeAdapter.address], [true]);

        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
    });
    describe("constructor", () => {
        it("should revert if token address is zero", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [ethers.constants.AddressZero, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    36000,
                    2,
                    [],
                    [],
                    [],
                    [],
                    [],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the fee adapter is zero", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero, ethers.constants.AddressZero],
                    3600,
                    2,
                    [],
                    [],
                    [],
                    [],
                    [],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set multibridge adapters", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [sourceBridgeAdapter.address],
                [],
                [],
                [],
                [],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.multiBridgeAdapters(sourceBridgeAdapter.address)).to.be.equal(true);
        });
        it("should set the controller for chains", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                [],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.getControllerForChain(50)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(100)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(200)).to.be.equal(ownerSigner.address);
        });
        it("should set the mint and burn selectors", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                [],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.MINT_SELECTOR()).to.be.equal("0x00000000");
            expect(await controller.BURN_SELECTOR()).to.be.equal("0x00000000");
        });
        it("should revert if the duration is zero", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [],
                    [],
                    [],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [],
                    [],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and burning limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [],
                    [200, 100],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges, burning or minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [1000],
                    [200, 100],
                    ["0x00000000", "0x00000000"],
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set limits for bridges", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            const bridgeParams = await controller.bridges(ownerSigner.address);
            expect(bridgeParams.minterParams.currentLimit).to.be.equal(1000);
            expect(bridgeParams.burnerParams.currentLimit).to.be.equal(200);
        });
        it("should give the PAUSE_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the PAUSE_ROLE to pauser", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), pauser.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the DEFAULT_ADMIN_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                ["0x00000000", "0x00000000"],
                ethers.constants.AddressZero
            );
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.equal(false);
        });
        describe("yield strategy", () => {
            beforeEach(async () => {
                const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
                aavePoolMock = await AavePoolMock.deploy(ownerSigner.address, sourceToken.address, "Aave Test Token", "aTEST");

                // Any non-zero address as the controller would work at this stage
                strategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [aavePoolMock.address, sourceToken.address, ownerSigner.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );
            });
            it("should set the yield strategy contract address", async () => {
                const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
                const controller = await AssetController.deploy(
                    [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    3600,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [1000],
                    [200],
                    ["0x00000000", "0x00000000"],
                    strategy.address
                );
                expect(await controller.yieldStrategy()).to.be.equal(strategy.address);
            });
            it("should revert if the asset in the yield strategy is other than the controller's token", async () => {
                // Mock - set a different underlying asset in Aave pool for aave yield strategy deployment to succeed
                await aavePoolMock.setUnderlyingAsset(destToken.address);
                // Any non-zero address as the controller would work at this stage
                strategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [aavePoolMock.address, destToken.address, ownerSigner.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                const AssetController = await ethers.getContractFactory("LockReleaseAssetController");
                await expect(
                    AssetController.deploy(
                        [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                        3600,
                        2,
                        [],
                        [],
                        [ownerSigner.address],
                        [1000],
                        [200],
                        ["0x00000000", "0x00000000"],
                        strategy.address
                    )
                ).to.be.revertedWithCustomError(AssetController, "Controller_InvalidStrategy");
            });
        });
    });
    describe("transfer To - single bridge", () => {
        beforeEach(async () => {
            // await helpers.time.increase(2000);
            relayerFee = ethers.utils.parseEther("0.001");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will lock the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
        });
        it("should lock the tokens to the contract", async () => {
            const userBalance = await sourceToken.balanceOf(ownerSigner.address);
            await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            const userBalanceAfter = await sourceToken.balanceOf(ownerSigner.address);
            const controllerBalance = await sourceToken.balanceOf(sourceController.address);
            expect(userBalance.sub(userBalanceAfter)).to.be.equal(amountToBridge);
            expect(controllerBalance).to.be.equal(amountToBridge);
        });
        it("should emit a LiquidityAdded event", async () => {
            expect(
                await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                )
            )
                .to.emit(sourceController, "LiquidityAdded")
                .withArgs(amountToBridge);
        });
        it("should revert if the transfer is not successful", async () => {
            // no allowance
            await sourceToken.connect(ownerSigner).approve(sourceController.address, 0);
            await expect(
                sourceController
                    .connect(ownerSigner)
                    ["transferTo(address,uint256,bool,uint256,address,bytes)"](
                        user1Signer.address,
                        amountToBridge,
                        false,
                        100,
                        sourceBridgeAdapter.address,
                        bridgeOptions,
                        {
                            value: relayerFee,
                        }
                    )
            ).to.be.revertedWith("ERC20: insufficient allowance");
        });
    });
    describe("receiveMessage", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");

            // Initially lock tokens in the source Lock/Release Controller
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
            await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            await connext.callXReceive(1);
        });
        it("should unlock the tokens on destination", async () => {
            // Bridge tokens from the destination (burn) to the source (release)
            // Approval needs to be given because controller will lock the tokens
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );

            const userBalanceBefore = await sourceToken.balanceOf(user1Signer.address);
            const balanceBefore = await sourceToken.balanceOf(sourceController.address);
            // Trigger message deliver
            await connext.callXReceive(2);
            const balanceAfter = await sourceToken.balanceOf(sourceController.address);
            expect(balanceBefore.sub(amountToBridge)).to.be.equal(balanceAfter);

            const userBalanceAfter = await sourceToken.balanceOf(user1Signer.address);
            expect(userBalanceBefore.add(amountToBridge)).to.be.equal(userBalanceAfter);
        });
        it("should unlock tokens if unwrap was set to true", async () => {
            // Bridge tokens from the destination (burn) to the source (release)
            // Approval needs to be given because controller will lock the tokens
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                true,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );

            const userBalanceBefore = await sourceToken.balanceOf(user1Signer.address);
            const balanceBefore = await sourceToken.balanceOf(sourceController.address);
            // Trigger message deliver
            await connext.callXReceive(2);
            const balanceAfter = await sourceToken.balanceOf(sourceController.address);
            expect(balanceBefore.sub(amountToBridge)).to.be.equal(balanceAfter);

            const userBalanceAfter = await sourceToken.balanceOf(user1Signer.address);
            expect(userBalanceBefore.add(amountToBridge)).to.be.equal(userBalanceAfter);
        });
        it("should emit a LiquidityRemoved event", async () => {
            // Bridge tokens from the destination (burn) to the source (release)
            // Approval needs to be given because controller will lock the tokens
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                true,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            await expect(connext.callXReceive(2)).to.emit(sourceController, "LiquidityRemoved").withArgs(amountToBridge);
        });
        it("should revert if the contract is paused", async () => {
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                true,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            await sourceController.pause();
            await expect(connext.callXReceive(2)).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if the Controller doesn't have enough tokens", async () => {
            // Bridge tokens from the destination (burn) to the source (release)
            // Approval needs to be given because controller will lock the tokens
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge.mul(2));
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge.mul(2),
                true,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            await expect(connext.callXReceive(2)).to.be.revertedWithCustomError(sourceController, "Controller_NotEnoughTokensInPool");
        });
        it("should use tokens transferred directly to the controller to release liquidity", async () => {
            const additionalTokens = ethers.utils.parseEther("200");
            const sourceControllerBalance = await sourceToken.balanceOf(sourceController.address);
            // Bridge tokens from the destination (burn) to the source (release)
            // Approval needs to be given because controller will lock the tokens
            await destToken.connect(ownerSigner).approve(destController.address, amountToBridge.add(additionalTokens));
            await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge.add(additionalTokens),
                true,
                50,
                destBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            expect(sourceControllerBalance).to.be.lt(amountToBridge.add(additionalTokens));
            // transfer tokens to LockRelease controller
            await sourceToken.transfer(sourceController.address, additionalTokens);
            await expect(connext.callXReceive(2)).to.emit(sourceController, "LiquidityRemoved").withArgs(amountToBridge.add(additionalTokens));
        });
    });
    describe("setTokenUnwrapping", () => {
        it("should revert if called by an admin", async () => {
            await expect(sourceController.connect(ownerSigner).setTokenUnwrapping(true)).to.be.revertedWithCustomError(
                sourceController,
                "Controller_UnwrappingNotSupported"
            );
        });
        it("should revert if not called by admin", async () => {
            await expect(sourceController.connect(user1Signer).setTokenUnwrapping(true)).to.be.reverted;
        });
    });
    describe("rescueTokens", () => {
        let erc20: Contract;
        beforeEach(async () => {
            const Token = await ethers.getContractFactory("USDTMock");
            erc20 = await Token.deploy("Rescue Token", "RSC");
            // Mint some tokens to controller
            await erc20.mint(sourceController.address, ethers.utils.parseEther("100"));
        });

        it("should allow admin to rescue tokens", async () => {
            const to = ownerSigner.address;
            const amount = ethers.utils.parseEther("10");
            const balanceBefore = await erc20.balanceOf(to);
            await sourceController.connect(ownerSigner).rescueTokens(erc20.address, to, amount);
            const balanceAfter = await erc20.balanceOf(to);
            expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
        });

        it("should revert if not admin", async () => {
            const defaultAdminRole = await sourceController.DEFAULT_ADMIN_ROLE();
            await expect(
                sourceController.connect(user1Signer).rescueTokens(erc20.address, ownerSigner.address, ethers.utils.parseEther("1"))
            ).to.be.revertedWith(`AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`);
        });

        it("should revert if to is zero address", async () => {
            await expect(
                sourceController.connect(ownerSigner).rescueTokens(erc20.address, ethers.constants.AddressZero, ethers.utils.parseEther("1"))
            ).to.be.revertedWithCustomError(sourceController, "Controller_ZeroAddress");
        });
    });

    describe("rescueETH", () => {
        beforeEach(async () => {
            // Send some ETH to controller
            await ownerSigner.sendTransaction({
                to: sourceController.address,
                value: ethers.utils.parseEther("1"),
            });
        });

        it("should allow admin to rescue ETH", async () => {
            const amount = ethers.utils.parseEther("0.1");
            const balanceBefore = await ethers.provider.getBalance(user1Signer.address);
            const tx = await sourceController.connect(ownerSigner).rescueETH(user1Signer.address, amount);
            await tx.wait();
            const balanceAfter = await ethers.provider.getBalance(user1Signer.address);
            expect(balanceAfter).to.be.equal(balanceBefore.add(amount));
        });

        it("should revert if not admin", async () => {
            const defaultAdminRole = await sourceController.DEFAULT_ADMIN_ROLE();
            await expect(sourceController.connect(user1Signer).rescueETH(ownerSigner.address, ethers.utils.parseEther("0.01"))).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should revert if to is zero address", async () => {
            await expect(
                sourceController.connect(ownerSigner).rescueETH(ethers.constants.AddressZero, ethers.utils.parseEther("0.01"))
            ).to.be.revertedWithCustomError(sourceController, "Controller_ZeroAddress");
        });
    });

    describe("Yield Strategy Functions", () => {
        beforeEach(async () => {
            // Deploy AavePoolMock
            const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
            aavePoolMock = await AavePoolMock.deploy(ownerSigner.address, sourceToken.address, "Aave Test Token", "aTEST");

            // Deploy YieldStrategy with temporary controller address
            strategy = await upgrades.deployProxy(
                YieldStrategy,
                [aavePoolMock.address, sourceToken.address, sourceController.address, ownerSigner.address],
                {
                    initializer: "initialize",
                }
            );

            // Set the strategy in the controller
            await sourceController.connect(ownerSigner).setYieldStrategy(strategy.address);

            // Grant YIELD_MANAGER_ROLE to yieldManager
            const yieldManagerRole = await sourceController.YIELD_MANAGER_ROLE();
            await sourceController.connect(ownerSigner).grantRole(yieldManagerRole, yieldManager.address);

            // Transfer tokens to controller for strategy operations
            await sourceToken.connect(ownerSigner).transfer(sourceController.address, ethers.utils.parseEther("10000"));
        });

        describe("setYieldStrategy", () => {
            it("should set the yield strategy", async () => {
                const newStrategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [aavePoolMock.address, sourceToken.address, sourceController.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                await expect(sourceController.connect(ownerSigner).setYieldStrategy(newStrategy.address))
                    .to.emit(sourceController, "YieldStrategySet")
                    .withArgs(strategy.address, newStrategy.address);

                expect(await sourceController.yieldStrategy()).to.equal(newStrategy.address);
            });

            it("should withdraw all principal from old strategy when setting new strategy", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const principalBefore = await strategy.getPrincipal();
                expect(principalBefore).to.equal(depositAmount);

                // Create new strategy
                const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
                const newAavePoolMock = await AavePoolMock.deploy(ownerSigner.address, sourceToken.address, "Aave Test Token 2", "aTEST2");

                const newStrategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [newAavePoolMock.address, sourceToken.address, sourceController.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);
                await sourceController.connect(ownerSigner).setYieldStrategy(newStrategy.address);

                // Old strategy should have zero principal
                const principalAfter = await strategy.getPrincipal();
                expect(principalAfter).to.equal(0);

                // Controller should have received the principal back
                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter.sub(controllerBalanceBefore)).to.equal(depositAmount);
            });

            it("should allow disabling strategy by setting to zero address", async () => {
                const depositAmount = ethers.utils.parseEther("500");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                await expect(sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero))
                    .to.emit(sourceController, "YieldStrategySet")
                    .withArgs(strategy.address, ethers.constants.AddressZero);

                expect(await sourceController.yieldStrategy()).to.equal(ethers.constants.AddressZero);

                // Principal should have been withdrawn
                const principalAfter = await strategy.getPrincipal();
                expect(principalAfter).to.equal(0);
            });

            it("should revert if new strategy asset does not match controller token", async () => {
                const Token = await ethers.getContractFactory("USDTMock");
                const wrongToken = await Token.deploy("Wrong Token", "WRONG");

                const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
                const wrongAavePoolMock = await AavePoolMock.deploy(ownerSigner.address, wrongToken.address, "Aave Wrong Token", "aWRONG");

                const wrongStrategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [wrongAavePoolMock.address, wrongToken.address, sourceController.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                await expect(sourceController.connect(ownerSigner).setYieldStrategy(wrongStrategy.address)).to.be.revertedWithCustomError(
                    sourceController,
                    "Controller_InvalidStrategy"
                );
            });

            it("should revert if not called by admin", async () => {
                const defaultAdminRole = await sourceController.DEFAULT_ADMIN_ROLE();
                await expect(sourceController.connect(user1Signer).setYieldStrategy(ethers.constants.AddressZero)).to.be.revertedWith(
                    `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
                );
            });

            it("should handle setting strategy when old strategy has no principal", async () => {
                // Don't deposit anything, just change strategy
                const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
                const newAavePoolMock = await AavePoolMock.deploy(ownerSigner.address, sourceToken.address, "Aave Test Token 2", "aTEST2");

                const newStrategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [newAavePoolMock.address, sourceToken.address, sourceController.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                await expect(sourceController.connect(ownerSigner).setYieldStrategy(newStrategy.address))
                    .to.emit(sourceController, "YieldStrategySet")
                    .withArgs(strategy.address, newStrategy.address);
            });
        });

        describe("deployToStrategy", () => {
            it("should deposit funds to the strategy", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                await expect(sourceController.connect(yieldManager).deployToStrategy(depositAmount))
                    .to.emit(sourceController, "FundsDeployedToStrategy")
                    .withArgs(depositAmount);

                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceBefore.sub(controllerBalanceAfter)).to.equal(depositAmount);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(depositAmount);
            });

            it("should revert if strategy is not set", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);

                await expect(sourceController.connect(yieldManager).deployToStrategy(ethers.utils.parseEther("100"))).to.be.revertedWithCustomError(
                    sourceController,
                    "Controller_InvalidStrategy"
                );
            });

            it("should revert if controller has insufficient liquidity", async () => {
                const excessAmount = ethers.utils.parseEther("20000");

                await expect(sourceController.connect(yieldManager).deployToStrategy(excessAmount)).to.be.revertedWithCustomError(
                    sourceController,
                    "Controller_InsufficientLiquidity"
                );
            });

            it("should revert if not called by yield manager", async () => {
                const yieldManagerRole = await sourceController.YIELD_MANAGER_ROLE();
                await expect(sourceController.connect(user1Signer).deployToStrategy(ethers.utils.parseEther("100"))).to.be.revertedWith(
                    `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${yieldManagerRole}`
                );
            });

            it("should handle deposits up to full controller balance", async () => {
                const controllerBalance = await sourceToken.balanceOf(sourceController.address);

                await expect(sourceController.connect(yieldManager).deployToStrategy(controllerBalance))
                    .to.emit(sourceController, "FundsDeployedToStrategy")
                    .withArgs(controllerBalance);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(controllerBalance);
            });
        });

        describe("withdrawFromStrategy", () => {
            const depositAmount = ethers.utils.parseEther("2000");

            beforeEach(async () => {
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);
            });

            it("should withdraw funds from the strategy", async () => {
                const withdrawAmount = ethers.utils.parseEther("500");
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                await expect(sourceController.connect(yieldManager).withdrawFromStrategy(withdrawAmount))
                    .to.emit(sourceController, "FundsWithdrawnFromStrategy")
                    .withArgs(withdrawAmount);

                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter.sub(controllerBalanceBefore)).to.equal(withdrawAmount);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(depositAmount.sub(withdrawAmount));
            });

            it("should revert if strategy is not set", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);

                await expect(
                    sourceController.connect(yieldManager).withdrawFromStrategy(ethers.utils.parseEther("100"))
                ).to.be.revertedWithCustomError(sourceController, "Controller_InvalidStrategy");
            });

            it("should revert if not called by yield manager", async () => {
                const yieldManagerRole = await sourceController.YIELD_MANAGER_ROLE();
                await expect(sourceController.connect(user1Signer).withdrawFromStrategy(ethers.utils.parseEther("100"))).to.be.revertedWith(
                    `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${yieldManagerRole}`
                );
            });

            it("should allow withdrawing all principal", async () => {
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                await sourceController.connect(yieldManager).withdrawFromStrategy(depositAmount);

                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter.sub(controllerBalanceBefore)).to.equal(depositAmount);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(0);
            });
        });

        describe("withdrawMaxFromStrategy", () => {
            const depositAmount = ethers.utils.parseEther("1500");

            beforeEach(async () => {
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);
            });

            it("should withdraw all principal from the strategy", async () => {
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                await expect(sourceController.connect(yieldManager).withdrawMaxFromStrategy())
                    .to.emit(sourceController, "FundsWithdrawnFromStrategy")
                    .withArgs(depositAmount);

                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter.sub(controllerBalanceBefore)).to.equal(depositAmount);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(0);
            });

            it("should revert if strategy is not set", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);

                await expect(sourceController.connect(yieldManager).withdrawMaxFromStrategy()).to.be.revertedWithCustomError(
                    sourceController,
                    "Controller_InvalidStrategy"
                );
            });

            it("should revert if not called by yield manager", async () => {
                const yieldManagerRole = await sourceController.YIELD_MANAGER_ROLE();
                await expect(sourceController.connect(user1Signer).withdrawMaxFromStrategy()).to.be.revertedWith(
                    `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${yieldManagerRole}`
                );
            });

            it("should withdraw correct amount after partial withdrawal", async () => {
                const partialWithdraw = ethers.utils.parseEther("500");
                await sourceController.connect(yieldManager).withdrawFromStrategy(partialWithdraw);

                const remainingPrincipal = depositAmount.sub(partialWithdraw);
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                await sourceController.connect(yieldManager).withdrawMaxFromStrategy();

                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter.sub(controllerBalanceBefore)).to.equal(remainingPrincipal);

                const principal = await strategy.getPrincipal();
                expect(principal).to.equal(0);
            });
        });

        describe("hasYieldStrategy", () => {
            it("should return true when strategy is set", async () => {
                expect(await sourceController.hasYieldStrategy()).to.be.true;
            });

            it("should return false when strategy is not set", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);
                expect(await sourceController.hasYieldStrategy()).to.be.false;
            });

            it("should return true after setting a new strategy", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);
                expect(await sourceController.hasYieldStrategy()).to.be.false;

                const AavePoolMock = await ethers.getContractFactory("AavePoolMock");
                const newAavePoolMock = await AavePoolMock.deploy(ownerSigner.address, sourceToken.address, "Aave Test Token 2", "aTEST2");

                const newStrategy = await upgrades.deployProxy(
                    YieldStrategy,
                    [newAavePoolMock.address, sourceToken.address, sourceController.address, ownerSigner.address],
                    {
                        initializer: "initialize",
                    }
                );

                await sourceController.connect(ownerSigner).setYieldStrategy(newStrategy.address);
                expect(await sourceController.hasYieldStrategy()).to.be.true;
            });
        });

        describe("getTotalValueLocked", () => {
            it("should return controller balance when no strategy is set", async () => {
                await sourceController.connect(ownerSigner).setYieldStrategy(ethers.constants.AddressZero);

                const controllerBalance = await sourceToken.balanceOf(sourceController.address);
                const tvl = await sourceController.getTotalValueLocked();

                expect(tvl).to.equal(controllerBalance);
            });

            it("should return sum of controller balance and strategy principal", async () => {
                const depositAmount = ethers.utils.parseEther("2000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const controllerBalance = await sourceToken.balanceOf(sourceController.address);
                const strategyPrincipal = await strategy.getPrincipal();
                const tvl = await sourceController.getTotalValueLocked();

                expect(tvl).to.equal(controllerBalance.add(strategyPrincipal));
            });

            it("should not include yield in TVL calculation", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const yieldAmount = ethers.utils.parseEther("150");
                await aavePoolMock.connect(ownerSigner).simulateYield(strategy.address, yieldAmount);

                const controllerBalance = await sourceToken.balanceOf(sourceController.address);
                const strategyPrincipal = await strategy.getPrincipal();
                const tvl = await sourceController.getTotalValueLocked();

                expect(tvl).to.equal(controllerBalance.add(strategyPrincipal));
            });

            it("should update correctly after deposits and withdrawals", async () => {
                const initialTvl = await sourceController.getTotalValueLocked();

                const depositAmount = ethers.utils.parseEther("1500");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const tvlAfterDeposit = await sourceController.getTotalValueLocked();
                expect(tvlAfterDeposit).to.equal(initialTvl);

                const withdrawAmount = ethers.utils.parseEther("500");
                await sourceController.connect(yieldManager).withdrawFromStrategy(withdrawAmount);

                const tvlAfterWithdraw = await sourceController.getTotalValueLocked();
                expect(tvlAfterWithdraw).to.equal(initialTvl);
            });

            it("should handle zero principal in strategy", async () => {
                const depositAmount = ethers.utils.parseEther("1000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);
                await sourceController.connect(yieldManager).withdrawMaxFromStrategy();

                const controllerBalance = await sourceToken.balanceOf(sourceController.address);
                const tvl = await sourceController.getTotalValueLocked();

                expect(tvl).to.equal(controllerBalance);
            });

            it("should reflect changes when tokens are added to controller", async () => {
                const depositAmount = ethers.utils.parseEther("800");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const tvlBefore = await sourceController.getTotalValueLocked();

                const additionalTokens = ethers.utils.parseEther("500");
                await sourceToken.connect(ownerSigner).transfer(sourceController.address, additionalTokens);

                const tvlAfter = await sourceController.getTotalValueLocked();
                expect(tvlAfter.sub(tvlBefore)).to.equal(additionalTokens);
            });
        });

        describe("receiveMessage with strategy enabled", () => {
            beforeEach(async () => {
                relayerFee = ethers.utils.parseEther("0.001");
                amountToBridge = ethers.utils.parseEther("500");
            });

            it("should handle receiving bridge transfers and maintaining strategy", async () => {
                // Deploy tokens to strategy
                const depositAmount = ethers.utils.parseEther("1000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                const principalBefore = await strategy.getPrincipal();

                // Simulate receiving tokens via bridge
                await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
                await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    50,
                    destBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                // Trigger message delivery
                await connext.callXReceive(1);

                // Strategy principal should remain unchanged
                const principalAfter = await strategy.getPrincipal();
                expect(principalAfter).to.equal(principalBefore);
            });

            it("should revert bridge if both controller and strategy lack liquidity", async () => {
                const controllerBalance = await sourceToken.balanceOf(sourceController.address);
                // Transfer all tokens away from controller
                await sourceController.connect(ownerSigner).rescueTokens(sourceToken.address, ownerSigner.address, controllerBalance);

                // Verify controller has no strategy deposits
                const strategyPrincipal = await strategy.getPrincipal();
                expect(strategyPrincipal).to.equal(0);

                // Now try to bridge from destination back to source (which would release tokens)
                await destToken.connect(ownerSigner).approve(destController.address, amountToBridge);
                await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    50,
                    destBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                // Should revert when trying to release tokens
                await expect(connext.callXReceive(1)).to.be.reverted;
            });

            it("should use both controller balance and strategy to fulfill large bridge request", async () => {
                // Get initial user1 balance
                const initialUser1Balance = await sourceToken.balanceOf(user1Signer.address);

                // Deploy most of the balance to strategy, leaving some in controller
                const depositAmount = ethers.utils.parseEther("8000");
                await sourceController.connect(yieldManager).deployToStrategy(depositAmount);

                // Generate yield in strategy
                const yieldAmount = ethers.utils.parseEther("300");
                await aavePoolMock.connect(ownerSigner).simulateYield(strategy.address, yieldAmount);

                // Bridge back large amount from destination - this should require withdrawing from strategy
                const largeAmount = ethers.utils.parseEther("5000");
                await destController.setLimits(destBridgeAdapter.address, largeAmount, largeAmount);
                await sourceController.setLimits(sourceBridgeAdapter.address, largeAmount, largeAmount);

                await destToken.connect(ownerSigner).approve(destController.address, largeAmount);
                await destController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    largeAmount,
                    false,
                    50,
                    destBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                // Transfer sufficient tokens to pool to cover the withdrawal
                await sourceToken.connect(ownerSigner).transfer(aavePoolMock.address, ethers.utils.parseEther("10000"));

                const principalBefore = await strategy.getPrincipal();
                const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

                // Verify controller doesn't have enough to cover largeAmount alone
                expect(controllerBalanceBefore).to.be.lt(largeAmount);
                const deficit = largeAmount.sub(controllerBalanceBefore);

                await expect(connext.callXReceive(1)).to.emit(sourceController, "FundsWithdrawnFromStrategy").withArgs(deficit);

                // Verify tokens were released to user
                const userBalance = await sourceToken.balanceOf(user1Signer.address);
                expect(userBalance).to.equal(initialUser1Balance.add(largeAmount));

                // Strategy should have been used to cover the deficit
                const principalAfter = await strategy.getPrincipal();
                expect(principalAfter).to.equal(principalBefore.sub(deficit));

                // Controller balance should be zero now
                const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
                expect(controllerBalanceAfter).to.equal(0);
            });
        });
    });
});
