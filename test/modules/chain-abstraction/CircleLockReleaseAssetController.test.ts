import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("CircleLockReleaseAssetController Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasury: SignerWithAddress;
    let pauser: SignerWithAddress;
    let burner: SignerWithAddress;
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
    let amountToBurn: any;

    const protocolFee = 5000;
    const multiBridgeFee = 500; // 0.5%
    const relayerFeeThreshold = ethers.utils.parseEther("0.0001");
    const minBridges = 2;
    const bridgeGasLimit = 2000000;

    const replenishDuration = 43200; // 12 hours
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasury, pauser, burner] = await ethers.getSigners();
        // upgrades.silenceWarnings();
        treasuryAddress = treasury.address;

        // Chain 50 - sourceController, BridgeAdapter
        // Chain 100 - destController, BridgeAdapter

        // Deploy Native Token
        const Token = await ethers.getContractFactory("USDCMock");
        sourceToken = await Token.deploy("Bridged USDC", "USDC.e", ownerSigner.address);
        await sourceToken.mint(ownerSigner.address, ethers.utils.parseEther("200"));

        // // Deploy XERC20 Token
        const XERC20 = await ethers.getContractFactory("XERC20Votes");
        // sourceToken = await XERC20.deploy(
        //     "Source Token",
        //     "SRC",
        //     [ownerSigner.address],
        //     [ethers.utils.parseEther("100000")],
        //     ownerSigner.address,
        //     treasury.address,
        //     [ethers.utils.parseEther("5"), ethers.utils.parseEther("500")],
        //     [100, 200]
        // );
        destToken = await XERC20.deploy("Dest LUSDC", "LUSDC", [], [], ownerSigner.address, ethers.constants.AddressZero, [], []);

        // Deploy Mock connext contract
        const Connext = await ethers.getContractFactory("ConnextMock");
        connext = await Connext.deploy();

        // Deploy FeeCollector contract
        const FeeCollector = await ethers.getContractFactory("FeeCollector");
        feeCollector = await FeeCollector.deploy(multiBridgeFee, treasuryAddress, ownerSigner.address);

        // Deploy AssetController contract
        const CircleLockReleaseAssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
        sourceController = await CircleLockReleaseAssetController.deploy(
            [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
            replenishDuration,
            minBridges,
            [],
            [],
            [],
            [],
            []
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
        await sourceToken.grantRole(await sourceToken.MINT_ROLE(), sourceController.address);
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
        amountToBurn = ethers.utils.parseEther("100");
    });
    describe("constructor", () => {
        it("should revert if token address is zero", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [ethers.constants.AddressZero, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    36000,
                    2,
                    [],
                    [],
                    [],
                    [],
                    []
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the fee adapter is zero", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero, ethers.constants.AddressZero],
                    3600,
                    2,
                    [],
                    [],
                    [],
                    [],
                    []
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set multibridge adapters", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [sourceBridgeAdapter.address],
                [],
                [],
                [],
                []
            );
            expect(await controller.multiBridgeAdapters(sourceBridgeAdapter.address)).to.be.equal(true);
        });
        it("should set the controller for chains", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                []
            );
            expect(await controller.getControllerForChain(50)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(100)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(200)).to.be.equal(ownerSigner.address);
        });
        it("should set the mint and burn selectors", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                []
            );
            expect(await controller.MINT_SELECTOR()).to.be.equal("0x40c10f19");
            expect(await controller.BURN_SELECTOR()).to.be.equal("0x42966c68");
        });
        it("should revert if the duration is zero", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [],
                    [],
                    []
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [],
                    []
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and bruning limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [],
                    [200, 100]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges, bruning or minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                    0,
                    2,
                    [],
                    [],
                    [ownerSigner.address],
                    [1000],
                    [200, 100]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set limits for bridges", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200]
            );
            const bridgeParams = await controller.bridges(ownerSigner.address);
            expect(bridgeParams.minterParams.currentLimit).to.be.equal(1000);
            expect(bridgeParams.burnerParams.currentLimit).to.be.equal(200);
        });
        it("should give the PAUSE_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200]
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the PAUSE_ROLE to pauser", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200]
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), pauser.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the DEFAULT_ADMIN_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("CircleLockReleaseAssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200]
            );
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.equal(false);
        });
    });
    describe("setAllowedTokensToBurn", () => {
        beforeEach(async () => {});
        it("should set the amount of tokens to burn if the caller is an admin", async () => {
            expect(await sourceController.connect(ownerSigner).setAllowedTokensToBurn(amountToBurn))
                .to.emit(sourceController, "AllowedTokensToBurnSet")
                .withArgs(amountToBurn);

            expect(await sourceController.allowedTokensToBurn()).to.be.equal(amountToBurn);
        });
        it("should revert if called not by an admin", async () => {
            await expect(sourceController.connect(user1Signer).setAllowedTokensToBurn(amountToBurn)).to.be.reverted;
        });
    });
    describe("burnLockedUSDC", () => {
        beforeEach(async () => {
            await sourceController.connect(ownerSigner).setAllowedTokensToBurn(amountToBurn);

            // Initially lock tokens in the source Lock/Release Controller
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBurn);
            await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBurn,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: ethers.utils.parseEther("0.013"),
                }
            );
            await connext.callXReceive(1);

            await sourceController.connect(ownerSigner).grantRole(await sourceController.BURN_LOCKED_TOKENS_ROLE(), burner.address);
        });
        it("should burn the amount of USDC tokens that is locked", async () => {
            const balanceBefore = await sourceToken.balanceOf(sourceController.address);
            await sourceController.connect(burner).burnLockedUSDC();
            const balanceAfter = await sourceToken.balanceOf(sourceController.address);
            expect(balanceBefore.sub(balanceAfter)).to.be.equal(amountToBurn);
        });
        it("should reduce amount to burn to zero", async () => {
            await sourceController.connect(burner).burnLockedUSDC();
            expect(await sourceController.allowedTokensToBurn()).to.be.equal(0);
        });
        it("should revert if an approval is not given", async () => {
            await sourceController.connect(ownerSigner).setAllowedTokensToBurn(0);
            await expect(sourceController.connect(burner).burnLockedUSDC()).to.be.revertedWithCustomError(
                sourceController,
                "Controller_NoTokensToBurn"
            );
        });
        it("should revert if called by a caller without BURN_LOCKED_TOKENS_ROLE", async () => {
            await sourceController.connect(ownerSigner).revokeRole(await sourceController.BURN_LOCKED_TOKENS_ROLE(), burner.address);
            await expect(sourceController.connect(burner).burnLockedUSDC()).to.be.reverted;
        });
    });
});
