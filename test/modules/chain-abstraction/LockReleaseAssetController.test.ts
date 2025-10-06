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

    const protocolFee = 5000;
    const multiBridgeFee = 500; // 0.5%
    const relayerFeeThreshold = ethers.utils.parseEther("0.0001");
    const minBridges = 2;
    const bridgeGasLimit = 2000000;

    const replenishDuration = 43200; // 12 hours
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasury, pauser] = await ethers.getSigners();
        // upgrades.silenceWarnings();
        treasuryAddress = treasury.address;

        // Chain 50 - sourceController, BridgeAdapter
        // Chain 100 - destController, BridgeAdapter

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
            ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                    ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
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
                ["0x00000000", "0x00000000"]
            );
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.equal(false);
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
    // TODO rescue tokens and rescue eth tests
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
});
