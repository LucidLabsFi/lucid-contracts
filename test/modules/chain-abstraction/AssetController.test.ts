import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("AssetController Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasury: SignerWithAddress;
    let pauser: SignerWithAddress;
    let treasuryAddress: string;
    let sourceToken: Contract;
    let destToken: Contract;
    let nativeToken: Contract;
    let lockbox: Contract;
    let feeCollector: Contract;
    let sourceController: Contract;
    let destController: Contract;
    let connext: Contract;
    let connext2: Contract;
    let relayerFee: BigNumber;
    let sourceBridgeAdapter: Contract;
    let destBridgeAdapter: Contract;
    let source2BridgeAdapter: Contract;
    let dest2BridgeAdapter: Contract;
    let amountToBridge: any;
    let transferId: string;
    let bridgeOptions: any;
    let mockToken: Contract;

    const protocolFee = 5000;
    const multiBridgeFee = 500; // 0.5%
    const relayerFeeThreshold = ethers.utils.parseEther("0.0001");
    const minBridges = 2;

    const mintSelector = "0x40c10f19"; // bytes4(keccak256(bytes("mint(address,uint256)")))
    const burnSelector = "0x9dc29fac"; // bytes4(keccak256(bytes("burn(address,uint256)")))
    // crosschainMint(address,uint256) // 0x18bf5077
    // crosschainBurn(address,uint256) // 0x2b8c49e3

    // ["transferTo(address,uint256,bool,uint256,address,bytes)"]
    // ["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"]
    // ["resendTransfer(bytes32,address,bytes)"]
    // ["resendTransfer(bytes32,address[],uint256[],bytes[])"]

    const replenishDuration = 43200; // 12 hours

    beforeEach(async () => {
        [ownerSigner, user1Signer, treasury, pauser] = await ethers.getSigners();
        // upgrades.silenceWarnings();
        treasuryAddress = treasury.address;

        // Chain 50 - sourceController, BridgeAdapter
        // Chain 100 - destController, BridgeAdapter

        // Deploy Native Token
        const Token = await ethers.getContractFactory("SimpleTokenOwnable");
        nativeToken = await Token.deploy(18);

        // Deploy XERC20 Token
        const XERC20 = await ethers.getContractFactory("XERC20Votes");
        sourceToken = await XERC20.deploy(
            "Source Token",
            "SRC",
            [ownerSigner.address],
            [ethers.utils.parseEther("100000")],
            ownerSigner.address,
            treasury.address,
            [ethers.utils.parseEther("5"), ethers.utils.parseEther("500")],
            [100, 200]
        );
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

        // Deploy Lockbox
        const Lockbox = await ethers.getContractFactory("XERC20Lockbox");
        lockbox = await Lockbox.deploy(destToken.address, nativeToken.address, false);

        // Set lockbox address in destToken
        await destToken.setLockbox(lockbox.address);

        // Deploy Mock connext contract
        const Connext = await ethers.getContractFactory("ConnextMock");
        connext = await Connext.deploy();
        connext2 = await Connext.deploy();

        // Deploy FeeCollector contract
        const FeeCollector = await ethers.getContractFactory("FeeCollector");
        feeCollector = await FeeCollector.deploy(multiBridgeFee, treasuryAddress, ownerSigner.address);

        // Deploy AssetController contract
        const AssetController = await ethers.getContractFactory("AssetControllerMock");
        sourceController = await AssetController.deploy(
            [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
            replenishDuration,
            minBridges,
            [],
            [],
            [],
            [],
            [],
            [mintSelector, burnSelector]
        );

        // Deploy Destination AssetController contract
        destController = await AssetController.deploy(
            [destToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
            replenishDuration,
            minBridges,
            [],
            [],
            [],
            [],
            [],
            [mintSelector, burnSelector]
        );

        // Set Bridge limits for Asset Controller in XERC20
        await sourceToken.setLimits(sourceController.address, ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000"));
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
        source2BridgeAdapter = await BridgeAdapter.deploy(
            connext2.address,
            "Connext Adapter 2",
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
        dest2BridgeAdapter = await BridgeAdapter.deploy(
            connext2.address,
            "Connext Adapter 2",
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
        await source2BridgeAdapter.setTrustedAdapter(100, dest2BridgeAdapter.address);
        await dest2BridgeAdapter.setTrustedAdapter(50, source2BridgeAdapter.address);

        // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
        await sourceController.setControllerForChain([100], [destController.address]);
        await destController.setControllerForChain([50], [sourceController.address]);

        // Set bridge limits
        await sourceController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(destBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await sourceController.setLimits(source2BridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(dest2BridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set bridge limits for whitelisted multiBridge adapters
        await sourceController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set domain Id for adapter contract, applycable to Connext adapters
        await sourceBridgeAdapter.setDomainId([50], [500]);
        await destBridgeAdapter.setDomainId([100], [1000]);
        await sourceBridgeAdapter.setDomainId([100], [1000]);
        await destBridgeAdapter.setDomainId([50], [500]);
        await source2BridgeAdapter.setDomainId([50], [500]);
        await dest2BridgeAdapter.setDomainId([100], [1000]);
        await source2BridgeAdapter.setDomainId([100], [1000]);
        await dest2BridgeAdapter.setDomainId([50], [500]);

        // set origin domain id in Mock Connext contract
        await connext.setOriginDomainId(sourceBridgeAdapter.address, 500); // domain id of the same chain of source adapter
        await connext.setOriginDomainId(destBridgeAdapter.address, 1000); // domain id of the same chain of dest adapter
        await connext2.setOriginDomainId(source2BridgeAdapter.address, 500); // domain id of the same chain of source adapter
        await connext2.setOriginDomainId(dest2BridgeAdapter.address, 1000); // domain id of the same chain of dest adapter

        // Set unlimited controllers in AssetController
        await sourceController.setMultiBridgeAdapters([sourceBridgeAdapter.address, source2BridgeAdapter.address], [true, true]);
        await destController.setMultiBridgeAdapters([destBridgeAdapter.address, dest2BridgeAdapter.address], [true, true]);

        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
    });
    describe("constructor", () => {
        it("should revert if token address is zero", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the fee adapter is zero", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set multibridge adapters", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [],
                [],
                [],
                [],
                [mintSelector, burnSelector]
            );
            expect(await controller.multiBridgeAdapters(sourceBridgeAdapter.address)).to.be.equal(true);
            expect(await controller.multiBridgeAdapters(source2BridgeAdapter.address)).to.be.equal(true);
        });
        it("should set the controller for chains", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                [],
                [mintSelector, burnSelector]
            );
            expect(await controller.getControllerForChain(50)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(100)).to.be.equal(ownerSigner.address);
            expect(await controller.getControllerForChain(200)).to.be.equal(ownerSigner.address);
        });
        // it("should revert if the mint selector is undefined", async () => {
        //     const AssetController = await ethers.getContractFactory("AssetController");
        //     await expect(
        //         AssetController.deploy(
        //             [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
        //             3600,
        //             2,
        //             [],
        //             [50, 100, 200],
        //             [],
        //             [],
        //             [],
        //             ["0x00000000", burnSelector]
        //         )
        //     ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        // });
        // it("should revert if the burn selector is undefined", async () => {
        //     const AssetController = await ethers.getContractFactory("AssetController");
        //     await expect(
        //         AssetController.deploy(
        //             [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
        //             3600,
        //             2,
        //             [],
        //             [50, 100, 200],
        //             [],
        //             [],
        //             [],
        //             [mintSelector, "0x00000000"]
        //         )
        //     ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        // });
        it("should set the mint and burn selectors", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ownerSigner.address],
                3600,
                2,
                [],
                [50, 100, 200],
                [],
                [],
                [],
                [mintSelector, burnSelector]
            );
            expect(await controller.MINT_SELECTOR()).to.be.equal(mintSelector);
            expect(await controller.BURN_SELECTOR()).to.be.equal(burnSelector);
        });
        it("should revert if the duration is zero", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges and bruning limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should revert if the bridges, bruning or minting limits length mismatch", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
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
                    [mintSelector, burnSelector]
                )
            ).to.be.revertedWithCustomError(AssetController, "Controller_Invalid_Params");
        });
        it("should set limits for bridges", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, ownerSigner.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                [mintSelector, burnSelector]
            );
            const bridgeParams = await controller.bridges(ownerSigner.address);
            expect(bridgeParams.minterParams.currentLimit).to.be.equal(1000);
            expect(bridgeParams.burnerParams.currentLimit).to.be.equal(200);
        });
        it("should give the PAUSE_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                [mintSelector, burnSelector]
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the PAUSE_ROLE to pauser", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                [mintSelector, burnSelector]
            );
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), pauser.address)).to.equal(true);
            expect(await controller.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the DEFAULT_ADMIN_ROLE to user1", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                [mintSelector, burnSelector]
            );
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), user1Signer.address)).to.equal(true);
            expect(await controller.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should set allowTokenUnwrapping to false", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            const controller = await AssetController.deploy(
                [sourceToken.address, user1Signer.address, pauser.address, feeCollector.address, ethers.constants.AddressZero],
                3600,
                2,
                [],
                [],
                [ownerSigner.address],
                [1000],
                [200],
                [mintSelector, burnSelector]
            );
            expect(await controller.allowTokenUnwrapping()).to.equal(false);
        });
    });
    describe("transferTo - single bridge", () => {
        beforeEach(async () => {
            // await helpers.time.increase(2000);
            relayerFee = ethers.utils.parseEther("0.001");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
        });
        it("should relay the message to the bridge adapter", async () => {
            expect(await connext.counter()).to.be.equal(0);
            await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {value: relayerFee}
            );
            expect(await connext.counter()).to.be.equal(1);
        });
        it("should emit a TransferCreated event", async () => {
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {value: relayerFee}
            );
            expect(await tx).to.emit(sourceController, "TransferCreated");

            const event = (await tx.wait()).events?.find((x: any) => x.event === "TransferCreated")?.args;
            expect(event.amount).to.equal(amountToBridge);
            expect(event.recipient).to.equal(user1Signer.address);
            expect(event.destChainId).to.equal(100);
            expect(event.sender).to.equal(ownerSigner.address);
            expect(event.threshold).to.equal(1);
            expect(event.unwrap).to.equal(false);
        });
        it("should emit a TransferRelayed event", async () => {
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {value: relayerFee}
            );
            await expect(tx).to.emit(sourceController, "TransferRelayed").withArgs(anyValue, sourceBridgeAdapter.address);
        });
        it("should increase the nonce ", async () => {
            const nonceBefore = await sourceController.nonce();
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
            const nonceAfter = await sourceController.nonce();
            expect(nonceBefore.add(1)).to.be.equal(nonceAfter);
        });
        it("should reduce the available burn limit", async () => {
            const limitBefore = await sourceController.burningCurrentLimitOf(sourceBridgeAdapter.address);
            const userBalanceBefore = await sourceToken.balanceOf(ownerSigner.address);
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
            const limitAfter = await sourceController.burningCurrentLimitOf(sourceBridgeAdapter.address);
            const userBalanceAfter = await sourceToken.balanceOf(ownerSigner.address);
            expect(limitBefore.sub(amountToBridge)).to.be.equal(limitAfter);
            expect(userBalanceBefore.sub(userBalanceAfter)).to.be.equal(amountToBridge);
        });
        it("should revert if the burn limit has been reached", async () => {
            await sourceController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("10"), ethers.utils.parseEther("10"));
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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
            ).to.be.revertedWithCustomError(sourceController, "Controller_NotHighEnoughLimits");
        });
        it("should revert if the burn fails", async () => {
            await sourceToken.connect(ownerSigner).approve(sourceController.address, 0);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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
            ).to.be.revertedWithCustomError(sourceController, "Controller_TokenBurnFailed");
        });
        it("should revert if contract is paused", async () => {
            await sourceController.pause();
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if transfers to the specific dest chain are paused", async () => {
            await sourceController.pauseTransfersToChain(100, true);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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
            ).to.be.revertedWithCustomError(sourceController, "Controller_TransfersPausedToDestination");
        });
        it("should revert if the adapter passed doesn't have a limit", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    100,
                    connext.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_NotHighEnoughLimits");
        });
        it("should revert if the amount is zero", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    0,
                    false,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_ZeroAmount");
        });
        it("should burn the tokens", async () => {
            const userBalanceBefore = await sourceToken.balanceOf(ownerSigner.address);
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
            expect(userBalanceBefore.sub(userBalanceAfter)).to.be.equal(amountToBridge);
        });
        describe("Set unwrap to true", () => {
            it("should emit a TransferCreated event", async () => {
                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    true,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {value: relayerFee}
                );
                await expect(tx).to.emit(sourceController, "TransferCreated").withArgs(
                    anyValue, // transferId
                    100,
                    1,
                    ownerSigner.address,
                    user1Signer.address,
                    amountToBridge,
                    true // unwrap
                );
            });
        });
    });
    describe("resendTransfer - single bridge", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferRelayed");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("should emit an TransferResent event", async () => {
            const tx = await sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                value: relayerFee,
            });
            await expect(tx).to.emit(sourceController, "TransferResent").withArgs(transferId);
        });
        it("should revert if contract is paused", async () => {
            await sourceController.pause();
            await expect(
                sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                    value: relayerFee,
                })
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if the transferId wasn't relayed in the past", async () => {
            const randomBytes = ethers.utils.randomBytes(32);
            await expect(
                sourceController["resendTransfer(bytes32,address,bytes)"](randomBytes, source2BridgeAdapter.address, bridgeOptions, {
                    value: relayerFee,
                })
            ).to.be.revertedWithCustomError(sourceController, "Controller_UnknownTransfer");
        });
        it("should revert if it's a multi-bridge transfer", async () => {
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const receipt = await tx.wait();
            const transferCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = transferCreatedEvent?.args?.transferId;

            await expect(
                sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                    value: relayerFee,
                })
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the adapter passed doesn't have a limit", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address,bytes)"](transferId, connext.address, bridgeOptions, {
                    value: relayerFee,
                })
            ).to.be.revertedWithCustomError(sourceController, "Controller_NotHighEnoughLimits");
        });
        it("should emit a TransferRelayed event", async () => {
            const tx = await sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                value: relayerFee,
            });
            await expect(tx).to.emit(sourceController, "TransferRelayed").withArgs(transferId, source2BridgeAdapter.address);
        });
        it("should relay the transfer to the new adapter", async () => {
            expect(await connext.counter()).to.be.equal(1);
            expect(await connext2.counter()).to.be.equal(0);
            await sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                value: relayerFee,
            });
            expect(await connext.counter()).to.be.equal(1);
            expect(await connext2.counter()).to.be.equal(1);
        });
    });
    describe("transferTo - multi bridge", () => {
        beforeEach(async () => {
            // await helpers.time.increase(2000);
            relayerFee = ethers.utils.parseEther("0.001");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);
        });
        it("should revert if msg.value > sum of the fees", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(3),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_FeesSumMismatch");
        });
        it("should revert if duplicate adapters are sent", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, sourceBridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_DuplicateAdapter");
        });
        it("should emit a TransferCreated event", async () => {
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const event = (await tx.wait()).events?.find((x: any) => x.event === "TransferCreated")?.args;
            expect(event.amount).to.be.equal(amountToBridge);
            expect(event.recipient).to.be.equal(ownerSigner.address);
            expect(event.destChainId).to.be.equal(100);
            expect(event.sender).to.be.equal(ownerSigner.address);
            expect(event.threshold).to.be.equal(2);
            expect(event.unwrap).to.be.equal(false);
        });
        it("should emit a TransferCreated event with the full amount if no fee has been taken", async () => {
            await feeCollector.setFeeBps(0); // turn off fee collection
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            await expect(tx).to.emit(sourceController, "TransferCreated");

            const receipt = await tx.wait();
            const event = receipt.events?.find((x: any) => x.event === "TransferCreated");
            const amount = event?.args?.amount;
            expect(amount).to.be.equal(amountToBridge);
        });
        it("should increase the nonce ", async () => {
            const nonceBefore = await sourceController.nonce();
            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const nonceAfter = await sourceController.nonce();
            expect(nonceBefore.add(1)).to.be.equal(nonceAfter);
        });
        it("should reduce the available multibridge burn limit", async () => {
            const limitBefore = await sourceController.burningCurrentLimitOf(ethers.constants.AddressZero);
            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const limitAfter = await sourceController.burningCurrentLimitOf(ethers.constants.AddressZero);
            expect(limitBefore.sub(amountToBridge)).to.be.equal(limitAfter);
        });
        it("should revert if limit is reached", async () => {
            await sourceController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("10"), ethers.utils.parseEther("10"));
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_NotHighEnoughLimits");
        });
        it("should revert if contract is paused", async () => {
            await sourceController.pause();
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if transfers to the specific dest chain are paused", async () => {
            await sourceController.pauseTransfersToChain(100, true);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_TransfersPausedToDestination");
        });
        it("should revert if the amount is zero", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    0,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_ZeroAmount");
        });
        it("should burn the tokens, deducting the fee for the transfer", async () => {
            const userBalanceBefore = await sourceToken.balanceOf(ownerSigner.address);
            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));
            const userBalanceAfter = await sourceToken.balanceOf(ownerSigner.address);
            expect(userBalanceBefore.sub(userBalanceAfter)).to.be.equal(amountToBridge.add(multiBridgeFeeAmount));
        });
        it("should revert if the adapters provided are less than minBridges", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if multibridge transfers are disabled (minBridges = 0)", async () => {
            await sourceController.setMinBridges(0);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_MultiBridgeTransfersDisabled");
        });
        it("should revert if a controller on the destination chains isn't registered", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    999,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Chain_Not_Supported");
        });
        it("should revert if the adapters and fees arrays mismatch", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the adapters and options arrays mismatch", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if one of the adapters provided is not whitelisted", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    100,
                    [sourceBridgeAdapter.address, destBridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_AdapterNotSupported");
        });
        describe("Set unwrap to true", () => {
            it("should emit a TransferCreated event", async () => {
                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    true,
                    100,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                );
                await expect(tx).to.emit(sourceController, "TransferCreated");

                const receipt = await tx.wait();
                const event = receipt.events?.find((x: any) => x.event === "TransferCreated");
                const unwrap = event?.args?.unwrap;
                expect(unwrap).to.be.equal(true);
            });
        });
    });
    describe("resendTransfer - multi bridge", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("should emit an TransferResent event", async () => {
            const tx = await sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                transferId,
                [source2BridgeAdapter.address],
                [relayerFee],
                [bridgeOptions],
                {
                    value: relayerFee,
                }
            );
            await expect(tx).to.emit(sourceController, "TransferResent").withArgs(transferId);
        });
        it("should not be able to resend a transfer using the same bridge that already delivered it", async () => {
            await connext.callXReceive(1);
            let receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);
            // resend message again
            await sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                transferId,
                [sourceBridgeAdapter.address],
                [relayerFee],
                [bridgeOptions],
                {
                    value: relayerFee,
                }
            );
            await expect(connext.callXReceive(2)).to.be.revertedWithCustomError(destController, "Controller_TransferResentByAadapter");
        });
        it("should allow anyone to resend a transaction", async () => {
            let receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.receivedSoFar).to.be.equal(0);
            // resend message with user1Signer
            await sourceController
                .connect(user1Signer)
                ["resendTransfer(bytes32,address[],uint256[],bytes[])"](transferId, [source2BridgeAdapter.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                });
            await connext2.callXReceive(1);
            receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);
        });
        it("should revert if msg.value > sum of the fees", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_FeesSumMismatch");
        });
        it("should revert if duplicate adapters are sent", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_DuplicateAdapter");
        });
        it("should revert if one of the adapters provided is not whitelisted", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [ownerSigner.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_AdapterNotSupported");
        });
        it("should revert if contract is paused", async () => {
            await sourceController.pause();
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if the transferId wasn't relayed in the past", async () => {
            const randomBytes = ethers.utils.randomBytes(32);
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    randomBytes,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_UnknownTransfer");
        });
        it("should revert if it's not a multi-bridge transfer", async () => {
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                ownerSigner.address,
                amountToBridge,
                false,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );
            const receipt = await tx.wait();
            const transferCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = transferCreatedEvent?.args?.transferId;

            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if multi bridge transfers are disabled (minBridges = 0)", async () => {
            await sourceController.setMinBridges(0);
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_MultiBridgeTransfersDisabled");
        });
        it("should revert if fee array lengths mismatch", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if options array lengths mismatch", async () => {
            await expect(
                sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                    transferId,
                    [source2BridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
    });
    describe("receiveMessage - single bridge", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
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

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("revert if originSender is not registered as a controller in originChain", async () => {
            await destController.setControllerForChain([50], [ethers.constants.AddressZero]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should revert if an executed transaction is resent", async () => {
            await connext.callXReceive(1);
            // resend transfer via another bridge
            await sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                value: relayerFee,
            });

            await expect(connext2.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_TransferNotExecutable");
        });
        it("should use the minting limit of the new bridge", async () => {
            const limitBefore = await destController.mintingCurrentLimitOf(destBridgeAdapter.address);
            await connext.callXReceive(1);
            const limitAfter = await destController.mintingCurrentLimitOf(destBridgeAdapter.address);
            expect(limitBefore.sub(amountToBridge)).to.be.equal(limitAfter);
        });
        it("should mint the tokens, minus any mint tax", async () => {
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            await connext.callXReceive(1);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
        });
        it("should emit an TransferExecuted event", async () => {
            const tx = await connext.callXReceive(1);
            await expect(tx).to.emit(destController, "TransferExecuted").withArgs(transferId);
        });
        it("should store the executed transfer", async () => {
            await connext.callXReceive(1);
            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.amount).to.be.equal(amountToBridge);
            expect(receivedTransfer.recipient).to.be.equal(user1Signer.address);
            expect(receivedTransfer.originChainId).to.be.equal(50);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);
            expect(receivedTransfer.threshold).to.be.equal(1);
            expect(receivedTransfer.executed).to.be.equal(true);
        });
        it("should emit an TransferReceived event", async () => {
            const tx = await connext.callXReceive(1);
            await expect(tx).to.emit(destController, "TransferReceived").withArgs(transferId, 50, destBridgeAdapter.address);
        });
    });
    describe("receiveMessage - single bridge - unwrap", () => {
        beforeEach(async () => {
            // allow token unwrapping in destination
            await destController.setTokenUnwrapping(true);
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");

            // Wrap tokens in lockbox in destination chain
            await nativeToken.approve(lockbox.address, amountToBridge.mul(2));
            await lockbox["deposit(uint256)"](amountToBridge.mul(2));

            // Approval needs to be given because controller will burn the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                true,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("should mint native tokens, minus any taxes", async () => {
            const userNativeBalanceBefore = await nativeToken.balanceOf(user1Signer.address);
            const userDestTokenBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            await connext.callXReceive(1);
            const userNativeBalanceAfter = await nativeToken.balanceOf(user1Signer.address);
            const userDestTokenBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userNativeBalanceAfter).to.be.equal(amountToBridge.add(userNativeBalanceBefore).sub(bridgeTax));
            expect(userDestTokenBalanceAfter).to.be.equal(userDestTokenBalanceBefore); // dest token balance should remain the same
        });
        it("should mint xerc20 tokens if the lockbox address is not set", async () => {
            await destToken.setLockbox(ethers.constants.AddressZero);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const userNativeBalanceBefore = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            await connext.callXReceive(1);
            const userNativeBalanceAfter = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            expect(userNativeBalanceAfter).to.be.equal(userNativeBalanceBefore); // native token balance should remain the same
        });
    });
    describe("receiveMessage - multi bridge", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("revert if originSender is not registered as a controller in originChain", async () => {
            await destController.setControllerForChain([50], [ethers.constants.AddressZero]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should revert if the multibridge adapter that delivered the message is not registered", async () => {
            await destController.setMultiBridgeAdapters([destBridgeAdapter.address], [false]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_AdapterNotSupported");
        });
        it("should revert if the same adapter delivers the message twice", async () => {
            await connext.callXReceive(1);
            // resend transfer using the same adapter
            const tx = await sourceController["resendTransfer(bytes32,address[],uint256[],bytes[])"](
                transferId,
                [sourceBridgeAdapter.address],
                [relayerFee],
                [bridgeOptions],
                {
                    value: relayerFee,
                }
            );

            await expect(connext.callXReceive(2)).to.be.revertedWithCustomError(destController, "Controller_TransferResentByAadapter");
        });
        it("should mark the transfer as delivered by the specific adapter", async () => {
            await connext.callXReceive(1);
            const deliveredBy = await destController.deliveredBy(transferId, destBridgeAdapter.address);
            expect(deliveredBy).to.be.equal(true);
        });
        describe("receiveMessage - first receipt", () => {
            beforeEach(async () => {});

            it("should store the executed transfer", async () => {
                await connext.callXReceive(1);
                const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));

                const receivedTransfer = await destController.receivedTransfers(transferId);
                expect(receivedTransfer.amount).to.be.equal(amountToBridge);
                expect(receivedTransfer.recipient).to.be.equal(user1Signer.address);
                expect(receivedTransfer.originChainId).to.be.equal(50);
                expect(receivedTransfer.receivedSoFar).to.be.equal(1);
                expect(receivedTransfer.threshold).to.be.equal(2);
                expect(receivedTransfer.executed).to.be.equal(false);
            });
            it("should not be able to execute the transfer", async () => {
                await connext.callXReceive(1);
                await expect(destController.execute(transferId)).to.be.revertedWithCustomError(destController, "Controller_ThresholdNotMet");
            });
        });
        describe("receiveMessage - second receipt", () => {
            beforeEach(async () => {
                await connext.callXReceive(1);
            });

            it("should store the executed transfer", async () => {
                await connext2.callXReceive(1);
                const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));

                const receivedTransfer = await destController.receivedTransfers(transferId);
                expect(receivedTransfer.amount).to.be.equal(amountToBridge);
                expect(receivedTransfer.recipient).to.be.equal(user1Signer.address);
                expect(receivedTransfer.originChainId).to.be.equal(50);
                expect(receivedTransfer.receivedSoFar).to.be.equal(2);
                expect(receivedTransfer.threshold).to.be.equal(2);
                expect(receivedTransfer.executed).to.be.equal(false);
            });
            it("should emit an TransferExecutable event", async () => {
                const tx = await connext2.callXReceive(1);
                await expect(tx).to.emit(destController, "TransferExecutable").withArgs(transferId);
            });
        });
        it("should emit an TransferReceived event", async () => {
            const tx = await connext.callXReceive(1);
            await expect(tx).to.emit(destController, "TransferReceived");
        });
    });
    describe("execute", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");
            // Approval needs to be given because controller will burn the tokens
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                user1Signer.address,
                amountToBridge,
                false,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
            await connext.callXReceive(1);
        });
        it("should revert if the transferId is unknown", async () => {
            await expect(destController.execute(ethers.utils.randomBytes(32))).to.be.revertedWithCustomError(
                destController,
                "Controller_UnknownTransfer"
            );
        });
        it("should revert if contract is paused", async () => {
            await connext2.callXReceive(1);
            await destController.pause();
            await expect(destController.execute(transferId)).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if the the threshold hasn't been met", async () => {
            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.threshold).to.be.equal(2);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);

            await expect(destController.execute(transferId)).to.be.revertedWithCustomError(destController, "Controller_ThresholdNotMet");
        });
        it("should revert if the transfer has already been executed", async () => {
            await connext2.callXReceive(1);
            await destController.execute(transferId);
            await expect(destController.execute(transferId)).to.be.revertedWithCustomError(destController, "Controller_TransferNotExecutable");
        });
        it("should reduce the available burn limit", async () => {
            await connext2.callXReceive(1);
            const limitBefore = await destController.mintingCurrentLimitOf(ethers.constants.AddressZero);
            await destController.execute(transferId);
            const limitAfter = await destController.mintingCurrentLimitOf(ethers.constants.AddressZero);
            const receivedTransfer = await destController.receivedTransfers(transferId);
            const amount = receivedTransfer.amount;
            expect(limitBefore.sub(amount)).to.be.equal(limitAfter);
        });
        it("should revert if the burn limit has been reached", async () => {
            await destController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("10"), ethers.utils.parseEther("10"));
            await connext2.callXReceive(1);
            await expect(destController.execute(transferId)).to.be.revertedWithCustomError(destController, "Controller_NotHighEnoughLimits");
        });
        it("should mark the transfer are executed", async () => {
            await connext2.callXReceive(1);
            await destController.execute(transferId);
            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.executed).to.be.equal(true);
        });
        it("should mint the tokens", async () => {
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));
            await connext2.callXReceive(1);
            await destController.execute(transferId);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userBalanceAfter.add(userBalanceBefore)).to.be.equal(amountToBridge.sub(bridgeTax));
        });
        it("should emit an TransferExecuted event", async () => {
            await connext2.callXReceive(1);
            const tx = await destController.execute(transferId);
            await expect(tx).to.emit(destController, "TransferExecuted").withArgs(transferId);
        });
    });
    describe("execute & unwrap", () => {
        beforeEach(async () => {
            // allow token unwrapping in destination
            await destController.setTokenUnwrapping(true);
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");

            // Wrap tokens in lockbox in destination chain
            await nativeToken.approve(lockbox.address, amountToBridge.mul(2));
            await lockbox["deposit(uint256)"](amountToBridge.mul(2));

            // Approval needs to be given because controller will burn the tokens
            const amountToBridgePlusFees = amountToBridge.mul(multiBridgeFee).div(100000).add(amountToBridge);
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridgePlusFees);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                user1Signer.address,
                amountToBridge,
                true,
                100,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
            await connext.callXReceive(1);
            await connext2.callXReceive(1);
        });
        it("should mint native tokens, minus any bridge tax", async () => {
            const userNativeBalanceBefore = await nativeToken.balanceOf(user1Signer.address);
            const userDestTokenBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));

            await destController.execute(transferId);
            const userNativeBalanceAfter = await nativeToken.balanceOf(user1Signer.address);
            const userDestTokenBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userNativeBalanceAfter).to.be.equal(amountToBridge.add(userNativeBalanceBefore).sub(bridgeTax));
            expect(userDestTokenBalanceAfter).to.be.equal(userDestTokenBalanceBefore); // dest token balance should remain the same
        });
        it("should mint xerc20 tokens if the lockbox address is not set", async () => {
            await destToken.setLockbox(ethers.constants.AddressZero);
            const userNativeBalanceBefore = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));

            await destController.execute(transferId);
            const userNativeBalanceAfter = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            expect(userNativeBalanceAfter).to.be.equal(userNativeBalanceBefore); // native token balance should remain the same
        });
    });
    describe("_unwrapAndMint", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.013");
            amountToBridge = ethers.utils.parseEther("100");

            // Wrap tokens in lockbox in destination chain
            await nativeToken.approve(lockbox.address, amountToBridge.mul(2));
            await lockbox["deposit(uint256)"](amountToBridge.mul(2));

            // Approval needs to be given because controller will burn the tokens
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                true,
                100,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
            transferId = msgCreatedEvent?.args?.transferId;
        });
        it("should transfer the xerc20 instead of unwrapping if allowTokenUnwrapping is false", async () => {
            // disable token unwrapping in destination
            await destController.setTokenUnwrapping(false);
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            await connext.callXReceive(1);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
        });
        describe("lockbox() reverts", () => {
            beforeEach(async () => {
                const TokenWithoutLockbox = await ethers.getContractFactory("SimpleToken");
                mockToken = await TokenWithoutLockbox.deploy();
                // mock - update token address in asset controller
                await destController.updateToken(mockToken.address);

                relayerFee = ethers.utils.parseEther("0.013");
                amountToBridge = ethers.utils.parseEther("100");

                // Wrap tokens in lockbox in destination chain
                await nativeToken.approve(lockbox.address, amountToBridge.mul(2));
                await lockbox["deposit(uint256)"](amountToBridge.mul(2));

                // Approval needs to be given because controller will burn the tokens
                await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    true,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
                transferId = msgCreatedEvent?.args?.transferId;
            });
            it("should transfer the xerc20 instead of reverting", async () => {
                // enable token unwrapping in destination
                await destController.setTokenUnwrapping(true);
                const userBalanceBefore = await mockToken.balanceOf(user1Signer.address);
                await connext.callXReceive(1);
                const userBalanceAfter = await mockToken.balanceOf(user1Signer.address);
                expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore));
            });
        });
        describe("lockbox() returns zero address", () => {
            beforeEach(async () => {
                relayerFee = ethers.utils.parseEther("0.013");
                amountToBridge = ethers.utils.parseEther("100");

                // Wrap tokens in lockbox in destination chain
                await nativeToken.approve(lockbox.address, amountToBridge.mul(2));
                await lockbox["deposit(uint256)"](amountToBridge.mul(2));

                // Approval needs to be given because controller will burn the tokens
                await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    true,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
                transferId = msgCreatedEvent?.args?.transferId;
            });
            it("should transfer the xerc20 instead of reverting", async () => {
                // change lockbox address to zero
                await destToken.setLockbox(ethers.constants.AddressZero);
                // enable token unwrapping in destination
                await destController.setTokenUnwrapping(true);
                const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
                const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
                await connext.callXReceive(1);
                const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
                expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            });
        });
        describe("lockbox has no ERC20 variable", () => {
            beforeEach(async () => {
                // mock - update lockbox
                const NewLockbox = await ethers.getContractFactory("XERC20LockboxNoERC20Mock");
                const newLockbox = await NewLockbox.deploy(destToken.address, nativeToken.address, false);
                await destToken.setLockbox(newLockbox.address);

                relayerFee = ethers.utils.parseEther("0.013");
                amountToBridge = ethers.utils.parseEther("100");

                // Wrap tokens in newLockbox in destination chain
                await nativeToken.approve(newLockbox.address, amountToBridge.mul(2));
                await newLockbox["deposit(uint256)"](amountToBridge.mul(2));

                // Approval needs to be given because controller will burn the tokens
                await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    true,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
                transferId = msgCreatedEvent?.args?.transferId;
            });
            it("should transfer the xerc20 instead of reverting", async () => {
                // enable token unwrapping in destination
                await destController.setTokenUnwrapping(true);
                const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
                const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
                await connext.callXReceive(1);
                const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
                expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            });
        });
        describe("lockbox has no withdraw function", () => {
            beforeEach(async () => {
                // mock - update lockbox
                const NewLockbox = await ethers.getContractFactory("XERC20LockboxNoWithdrawMock");
                const newLockbox = await NewLockbox.deploy(destToken.address, nativeToken.address, false);
                await destToken.setLockbox(newLockbox.address);

                relayerFee = ethers.utils.parseEther("0.013");
                amountToBridge = ethers.utils.parseEther("100");

                // Wrap tokens in newLockbox in destination chain
                await nativeToken.approve(newLockbox.address, amountToBridge.mul(2));
                await newLockbox["deposit(uint256)"](amountToBridge.mul(2));

                // Approval needs to be given because controller will burn the tokens
                await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);

                const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    true,
                    100,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "TransferCreated");
                transferId = msgCreatedEvent?.args?.transferId;
            });
            it("should transfer the xerc20 instead of reverting", async () => {
                // enable token unwrapping in destination
                await destController.setTokenUnwrapping(true);
                const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
                const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
                await connext.callXReceive(1);
                const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
                expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            });
        });
    });
    describe("setControllerForChain", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setControllerForChain([200, 300], [sourceController.address, sourceController.address]))
                .to.be.reverted;
        });
        it("should set the controller address for multiple chain IDs", async () => {
            const randomController1 = ethers.Wallet.createRandom().address;
            const randomController2 = ethers.Wallet.createRandom().address;

            await destController.connect(ownerSigner).setControllerForChain([200, 300], [randomController1, randomController2]);

            expect(await destController.getControllerForChain(200)).to.equal(randomController1);
            expect(await destController.getControllerForChain(300)).to.equal(randomController2);
        });
        it("should emit a ControllerForChainSet event", async () => {
            const randomController1 = ethers.Wallet.createRandom().address;
            const randomController2 = ethers.Wallet.createRandom().address;
            const tx = await destController.connect(ownerSigner).setControllerForChain([200, 300], [randomController1, randomController2]);

            await expect(tx)
                .to.emit(destController, "ControllerForChainSet")
                .withArgs(randomController1, 200)
                .and.to.emit(destController, "ControllerForChainSet")
                .withArgs(randomController2, 300);
        });
        it("should set the controller address for a single chain ID", async () => {
            const randomController = ethers.Wallet.createRandom().address;

            await destController.connect(ownerSigner).setControllerForChain([200], [randomController]);

            expect(await destController.getControllerForChain(200)).to.equal(randomController);
        });
        it("should revert if the chain ID and controller address arrays do not have the same length", async () => {
            await expect(
                destController.connect(ownerSigner).setControllerForChain([200], [sourceController.address, sourceController.address])
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");

            await expect(
                destController.connect(ownerSigner).setControllerForChain([200, 300], [sourceController.address])
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
    });
    describe("setMinBridges", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setMinBridges(2)).to.be.reverted;
        });
        it("should set the minBridges", async () => {
            await destController.connect(ownerSigner).setMinBridges(10);
            expect(await destController.minBridges()).to.equal(10);
        });
    });
    describe("setLimits", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(
                destController
                    .connect(user1Signer)
                    .setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("100"), ethers.utils.parseEther("100"))
            ).to.be.reverted;
        });
        it("should revert if the new minting limits are > (uint256 max / 2)", async () => {
            await expect(
                destController
                    .connect(ownerSigner)
                    .setLimits(ethers.constants.AddressZero, ethers.constants.MaxUint256.div(2).add(1), ethers.utils.parseEther("100"))
            ).to.be.revertedWithCustomError(destController, "Controller_LimitsTooHigh");
        });
        it("should revert if the new burning limits are > (uint256 max / 2)", async () => {
            await expect(
                destController
                    .connect(ownerSigner)
                    .setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("100"), ethers.constants.MaxUint256.div(2).add(1))
            ).to.be.revertedWithCustomError(destController, "Controller_LimitsTooHigh");
        });
    });
    describe("setMultiBridgeAdapters", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setMultiBridgeAdapters([sourceBridgeAdapter.address], [true])).to.be.reverted;
        });
        it("should set the limitlessness of the adapters", async () => {
            await destController.connect(ownerSigner).setMultiBridgeAdapters([destBridgeAdapter.address, user1Signer.address], [false, true]);
            expect(await destController.multiBridgeAdapters(destBridgeAdapter.address)).to.equal(false);
            expect(await destController.multiBridgeAdapters(user1Signer.address)).to.equal(true);
        });
        it("should revert if the arrays are not the same length", async () => {
            await expect(
                destController.connect(ownerSigner).setMultiBridgeAdapters([sourceBridgeAdapter.address], [true, true])
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should emit a MultiBridgeAdapterSet event", async () => {
            const tx = await destController.connect(ownerSigner).setMultiBridgeAdapters([destBridgeAdapter.address], [true]);
            await expect(tx).to.emit(destController, "MultiBridgeAdapterSet").withArgs(destBridgeAdapter.address, true);
        });
    });
    describe("setTokenUnwrapping", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setTokenUnwrapping(true)).to.be.reverted;
        });
        it("should set the minBridges", async () => {
            await destController.connect(ownerSigner).setTokenUnwrapping(true);
            expect(await destController.allowTokenUnwrapping()).to.equal(true);
        });
        it("should emit a AllowTokenUnwrappingSet event", async () => {
            const tx = await destController.connect(ownerSigner).setTokenUnwrapping(true);
            await expect(tx).to.emit(destController, "AllowTokenUnwrappingSet").withArgs(true);
        });
    });
    describe("pauseTransfersToChain", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).pauseTransfersToChain(50, true)).to.be.reverted;
        });
        it("should pause transfers to a specific chain", async () => {
            expect(await destController.transfersPausedTo(50)).to.be.false;
            await destController.connect(ownerSigner).pauseTransfersToChain(50, true);
            expect(await destController.transfersPausedTo(50)).to.be.true;
        });
        it("should emit a TransfersPausedToChain event", async () => {
            const tx = await destController.connect(ownerSigner).pauseTransfersToChain(50, true);
            await expect(tx).to.emit(destController, "TransfersPausedToChain").withArgs(50, true);
        });
    });
    describe("withdraw", () => {
        beforeEach(async () => {
            const initialBalance = ethers.utils.parseEther("10"); // 10 ETH
            await ownerSigner.sendTransaction({to: sourceController.address, value: initialBalance});
        });
        it("should allow only the owner to withdraw", async () => {
            await expect(sourceController.connect(user1Signer).withdraw(user1Signer.address)).to.be.reverted;
            await expect(sourceController.connect(ownerSigner).withdraw(user1Signer.address)).to.not.be.reverted;
        });
        it("should withdraw the correct amount to the recipient", async () => {
            // get user1signer balance before and after the withdrawal
            const initialBalance = await ethers.provider.getBalance(user1Signer.address);
            await sourceController.connect(ownerSigner).withdraw(user1Signer.address);
            const finalBalance = await ethers.provider.getBalance(user1Signer.address);
            expect(finalBalance.sub(initialBalance)).to.equal(ethers.utils.parseEther("10"));
        });
        it("should update contract balance to zero after withdrawal", async () => {
            await sourceController.connect(ownerSigner).withdraw(user1Signer.address);

            const contractBalance = await ethers.provider.getBalance(sourceController.address);
            expect(contractBalance).to.equal(0);
        });
    });
    describe("grantRole", () => {
        it("should revert if non admin attempts to set DEFAULT_ADMIN_ROLE", async () => {
            const defaultAdminRole = await destController.DEFAULT_ADMIN_ROLE();
            await expect(destController.connect(user1Signer).grantRole(defaultAdminRole, user1Signer.address)).to.be.reverted;
        });
        it("should set DEFAULT_ADMIN_ROLE", async () => {
            const defaultAdminRole = await destController.DEFAULT_ADMIN_ROLE();

            await destController.connect(ownerSigner).grantRole(defaultAdminRole, user1Signer.address);
            expect(await destController.hasRole(defaultAdminRole, user1Signer.address)).to.be.true;
        });
        it("should revert if a user with PAUSE_ROLE attempts to give it to another user", async () => {
            const pauseRole = await destController.PAUSE_ROLE();
            await destController.connect(ownerSigner).revokeRole(pauseRole, ownerSigner.address);
            expect(await destController.hasRole(pauseRole, ownerSigner.address)).to.be.false;
            expect(await destController.hasRole(pauseRole, user1Signer.address)).to.be.false;

            await destController.connect(ownerSigner).grantRole(pauseRole, user1Signer.address);
            expect(await destController.hasRole(pauseRole, user1Signer.address)).to.be.true;
            await expect(destController.connect(user1Signer).grantRole(pauseRole, ownerSigner.address)).to.be.reverted;
        });
    });
    describe("pause", () => {
        it("should revert if an admin with no PAUSE_ROLE attempts to pause the contract", async () => {
            await destController.revokeRole(await destController.PAUSE_ROLE(), ownerSigner.address);
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.be.true;
            await expect(destController.connect(ownerSigner).pause()).to.be.reverted;
        });
        it("should revert if non admin attempts to pause the contract", async () => {
            await expect(destController.connect(user1Signer).pause()).to.be.reverted;
        });
        it("should pause the contract", async () => {
            await destController.connect(ownerSigner).pause();
            expect(await destController.paused()).to.be.true;
        });
    });
    describe("unpause", () => {
        beforeEach(async () => {
            await destController.connect(ownerSigner).pause();
        });
        it("should revert if  with no PAUSE_ROLE attempts to unpause the contract", async () => {
            await destController.revokeRole(await destController.PAUSE_ROLE(), ownerSigner.address);
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.be.true;
            await expect(destController.connect(ownerSigner).unpause()).to.be.reverted;
        });
        it("should revert if non admin attempts to unpause the contract", async () => {
            await expect(destController.connect(user1Signer).unpause()).to.be.reverted;
        });
        it("should unpause the contract", async () => {
            await destController.connect(ownerSigner).unpause();
            expect(await destController.paused()).to.be.false;
        });
    });
});
