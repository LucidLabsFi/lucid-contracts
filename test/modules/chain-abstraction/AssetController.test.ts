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
    const sourceChainId = 31337;
    const destinationChainId = sourceChainId;

    const mintSelector = "0x40c10f19"; // bytes4(keccak256(bytes("mint(address,uint256)")))
    const burnSelector = "0x9dc29fac"; // bytes4(keccak256(bytes("burn(address,uint256)")))
    const burnSelectorSingle = "0x42966c68"; // bytes4(keccak256(bytes("burn(uint256)")))
    // crosschainMint(address,uint256) // 0x18bf5077
    // crosschainBurn(address,uint256) // 0x2b8c49e3

    // ["transferTo(address,uint256,bool,uint256,address,bytes)"]
    // ["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"]
    // ["resendTransfer(bytes32,address,bytes)"]
    // ["resendTransfer(bytes32,address[],uint256[],bytes[])"]

    const replenishDuration = 43200; // 12 hours
    const encodeTransfer = (
        nonce: BigNumber | number,
        destChainId: BigNumber | number,
        recipient: string,
        amount: BigNumber,
        unwrap: boolean,
        threshold: number,
        id: string
    ) =>
        ethers.utils.defaultAbiCoder.encode(
            ["tuple(uint256 nonce,uint256 destChainId,address recipient,uint256 amount,bool unwrap,uint256 threshold,bytes32 transferId)"],
            [{nonce, destChainId, recipient, amount, unwrap, threshold, transferId: id}]
        );

    beforeEach(async () => {
        [ownerSigner, user1Signer, treasury, pauser] = await ethers.getSigners();
        // upgrades.silenceWarnings();
        treasuryAddress = treasury.address;

        // Chain 31337 - sourceController, BridgeAdapter
        // Chain 31337 - destController, BridgeAdapter

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
            [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
            [destToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
            [destinationChainId],
            [1000],
            ownerSigner.address
        );
        source2BridgeAdapter = await BridgeAdapter.deploy(
            connext2.address,
            "Connext Adapter 2",
            relayerFeeThreshold,
            treasuryAddress,
            protocolFee,
            [destinationChainId],
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
            [sourceChainId],
            [500],
            ownerSigner.address
        );
        dest2BridgeAdapter = await BridgeAdapter.deploy(
            connext2.address,
            "Connext Adapter 2",
            relayerFeeThreshold,
            treasuryAddress,
            protocolFee,
            [sourceChainId],
            [500],
            ownerSigner.address
        );

        // After bridge addapters' address is known, set it in the other adapter contract
        await sourceBridgeAdapter.setTrustedAdapter(destinationChainId, destBridgeAdapter.address);
        await destBridgeAdapter.setTrustedAdapter(sourceChainId, sourceBridgeAdapter.address);
        await source2BridgeAdapter.setTrustedAdapter(destinationChainId, dest2BridgeAdapter.address);
        await dest2BridgeAdapter.setTrustedAdapter(sourceChainId, source2BridgeAdapter.address);

        // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
        await sourceController.setControllerForChain([destinationChainId], [destController.address]);
        await destController.setControllerForChain([sourceChainId], [sourceController.address]);

        // Set bridge limits
        await sourceController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(destBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await sourceController.setLimits(source2BridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(dest2BridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set bridge limits for whitelisted multiBridge adapters
        await sourceController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
        await destController.setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

        // Set domain Id for adapter contract, applycable to Connext adapters
        await sourceBridgeAdapter.setDomainId([sourceChainId], [500]);
        await destBridgeAdapter.setDomainId([destinationChainId], [1000]);
        await sourceBridgeAdapter.setDomainId([destinationChainId], [1000]);
        await destBridgeAdapter.setDomainId([sourceChainId], [500]);
        await source2BridgeAdapter.setDomainId([sourceChainId], [500]);
        await dest2BridgeAdapter.setDomainId([destinationChainId], [1000]);
        await source2BridgeAdapter.setDomainId([destinationChainId], [1000]);
        await dest2BridgeAdapter.setDomainId([sourceChainId], [500]);

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
                    [ethers.constants.AddressZero, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
        it("should revert if owner address is zero", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ethers.constants.AddressZero, pauser.address, ethers.constants.AddressZero],
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
        it("should revert if minBridges is 1", async () => {
            const AssetController = await ethers.getContractFactory("AssetController");
            await expect(
                AssetController.deploy(
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
                    3600,
                    1,
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
                [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, ownerSigner.address, pauser.address, ownerSigner.address],
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
        //             [sourceToken.address, ownerSigner.address, pauser.address, ownerSigner.address],
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
        //             [sourceToken.address, ownerSigner.address, pauser.address, ownerSigner.address],
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
                [sourceToken.address, ownerSigner.address, pauser.address, ownerSigner.address],
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
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                    [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, user1Signer.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, user1Signer.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, user1Signer.address, pauser.address, ethers.constants.AddressZero],
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
                [sourceToken.address, user1Signer.address, pauser.address, ethers.constants.AddressZero],
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
    describe("calculateTransferId", () => {
        it("should bind the transfer id to nonce and transfer details", async () => {
            const amount = ethers.utils.parseEther("1");
            const baseTransferId = await sourceController.calculateTransferId(destinationChainId, 0, user1Signer.address, amount, false, 2);

            expect(await sourceController.calculateTransferId(destinationChainId, 1, user1Signer.address, amount, false, 2)).to.not.equal(
                baseTransferId
            );
            expect(await sourceController.calculateTransferId(destinationChainId, 0, ownerSigner.address, amount, false, 2)).to.not.equal(
                baseTransferId
            );
            expect(await sourceController.calculateTransferId(destinationChainId, 0, user1Signer.address, amount.add(1), false, 2)).to.not.equal(
                baseTransferId
            );
            expect(await sourceController.calculateTransferId(destinationChainId, 0, user1Signer.address, amount, true, 2)).to.not.equal(
                baseTransferId
            );
            expect(await sourceController.calculateTransferId(destinationChainId, 0, user1Signer.address, amount, false, 1)).to.not.equal(
                baseTransferId
            );
        });
    });
    describe("transfer sender whitelist", () => {
        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.001");
            amountToBridge = ethers.utils.parseEther("100");
        });
        it("should disable whitelist enforcement by default and not whitelist any sender", async () => {
            expect(await sourceController.transferSenderWhitelistEnabled()).to.equal(false);
            expect(await sourceController.transferSenders(ownerSigner.address)).to.equal(false);
            expect(await sourceController.transferSenders(user1Signer.address)).to.equal(false);
        });
        it("should revert single-bridge transfers from a non-whitelisted sender when whitelist enforcement is enabled", async () => {
            await sourceController.setTransferSenderWhitelistEnabled(true);
            await expect(
                sourceController.connect(user1Signer)["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {value: relayerFee}
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_SenderNotWhitelisted");
        });
        it("should revert multi-bridge transfers from a non-whitelisted sender when whitelist enforcement is enabled", async () => {
            await sourceController.setTransferSenderWhitelistEnabled(true);
            await expect(
                sourceController.connect(user1Signer)["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {value: relayerFee.mul(2)}
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_SenderNotWhitelisted");
        });
        it("should allow a whitelisted sender to transfer when whitelist enforcement is enabled", async () => {
            await sourceController.setTransferSenderWhitelistEnabled(true);
            await sourceController.setTransferSenders([user1Signer.address], [true]);
            await sourceToken.transfer(user1Signer.address, amountToBridge);
            await sourceToken.connect(user1Signer).approve(sourceController.address, amountToBridge);

            await expect(
                sourceController.connect(user1Signer)["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {value: relayerFee}
                )
            ).to.emit(sourceController, "TransferCreated");
        });
        it("should allow any sender to transfer when whitelist enforcement is disabled", async () => {
            await sourceToken.transfer(user1Signer.address, amountToBridge);
            await sourceToken.connect(user1Signer).approve(sourceController.address, amountToBridge);

            await expect(
                sourceController.connect(user1Signer)["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {value: relayerFee}
                )
            ).to.emit(sourceController, "TransferCreated");
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
                destinationChainId,
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
                destinationChainId,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {value: relayerFee}
            );
            expect(await tx).to.emit(sourceController, "TransferCreated");

            const event = (await tx.wait()).events?.find((x: any) => x.event === "TransferCreated")?.args;
            expect(event.amount).to.equal(amountToBridge);
            expect(event.recipient).to.equal(user1Signer.address);
            expect(event.destChainId).to.equal(destinationChainId);
            expect(event.sender).to.equal(ownerSigner.address);
            expect(event.threshold).to.equal(1);
            expect(event.unwrap).to.equal(false);
        });
        it("should emit a TransferRelayed event", async () => {
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                destinationChainId,
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
                destinationChainId,
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
                destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if transfers to the specific dest chain are paused", async () => {
            await sourceController.pauseTransfersToChain(destinationChainId, true);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                destinationChainId,
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
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {value: relayerFee}
                );
                await expect(tx).to.emit(sourceController, "TransferCreated").withArgs(
                    anyValue, // transferId
                    destinationChainId,
                    1,
                    ownerSigner.address,
                    user1Signer.address,
                    amountToBridge,
                    true // unwrap
                );
            });
        });
    });
    describe("transferTo - single bridge - burn(uint256)", () => {
        let singleSelectorToken: Contract;
        let singleSelectorController: Contract;

        beforeEach(async () => {
            relayerFee = ethers.utils.parseEther("0.001");
            amountToBridge = ethers.utils.parseEther("100");

            const XERC20 = await ethers.getContractFactory("XERC20Votes");
            singleSelectorToken = await XERC20.deploy(
                "Single Selector Token",
                "SST",
                [ownerSigner.address],
                [ethers.utils.parseEther("100000")],
                ownerSigner.address,
                treasury.address,
                [ethers.utils.parseEther("5"), ethers.utils.parseEther("500")],
                [100, 200]
            );

            const AssetController = await ethers.getContractFactory("AssetControllerMock");
            singleSelectorController = await AssetController.deploy(
                [singleSelectorToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
                replenishDuration,
                minBridges,
                [],
                [],
                [],
                [],
                [],
                [mintSelector, burnSelectorSingle]
            );

            await singleSelectorController.setControllerForChain([destinationChainId], [destController.address]);
            await singleSelectorController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
            await singleSelectorToken.setLimits(singleSelectorController.address, ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000"));
            await singleSelectorToken.connect(ownerSigner).approve(singleSelectorController.address, amountToBridge);
        });

        it("should burn the tokens and leave no residue in the controller", async () => {
            const controllerBalanceBefore = await singleSelectorToken.balanceOf(singleSelectorController.address);

            await singleSelectorController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                user1Signer.address,
                amountToBridge,
                false,
                destinationChainId,
                sourceBridgeAdapter.address,
                bridgeOptions,
                {
                    value: relayerFee,
                }
            );

            const controllerBalanceAfter = await singleSelectorToken.balanceOf(singleSelectorController.address);
            expect(controllerBalanceBefore).to.equal(0);
            expect(controllerBalanceAfter).to.equal(0);
        });

        it("should revert if burn(uint256) succeeds without reducing the controller balance", async () => {
            const NoOpBurnToken = await ethers.getContractFactory("NoOpBurnTokenMock");
            const noOpBurnToken = await NoOpBurnToken.deploy();

            const AssetController = await ethers.getContractFactory("AssetControllerMock");
            const noOpController = await AssetController.deploy(
                [noOpBurnToken.address, ownerSigner.address, pauser.address, ethers.constants.AddressZero],
                replenishDuration,
                minBridges,
                [],
                [],
                [],
                [],
                [],
                [mintSelector, burnSelectorSingle]
            );

            await noOpController.setControllerForChain([destinationChainId], [destController.address]);
            await noOpController.setLimits(sourceBridgeAdapter.address, ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
            await noOpBurnToken.connect(ownerSigner).approve(noOpController.address, amountToBridge);

            await expect(
                noOpController["transferTo(address,uint256,bool,uint256,address,bytes)"](
                    user1Signer.address,
                    amountToBridge,
                    false,
                    destinationChainId,
                    sourceBridgeAdapter.address,
                    bridgeOptions,
                    {
                        value: relayerFee,
                    }
                )
            ).to.be.revertedWithCustomError(noOpController, "Controller_TokenBurnFailed");
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
                destinationChainId,
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
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
            const tx = await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                user1Signer.address,
                amountToBridge,
                false,
                destinationChainId,
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
            ).to.be.revertedWithCustomError(sourceController, "Controller_AdapterNotSupported");
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
            await sourceToken.connect(ownerSigner).approve(sourceController.address, amountToBridge);
        });
        it("should revert if msg.value > sum of the fees", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
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
                    destinationChainId,
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
                sourceChainId,
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
            expect(event.destChainId).to.be.equal(destinationChainId);
            expect(event.sender).to.be.equal(ownerSigner.address);
            expect(event.threshold).to.be.equal(2);
            expect(event.unwrap).to.be.equal(false);
        });
        it("should increase the nonce ", async () => {
            const nonceBefore = await sourceController.nonce();
            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                destinationChainId,
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
                destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
            await sourceController.pauseTransfersToChain(destinationChainId, true);
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
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
                    destinationChainId,
                    [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                )
            ).to.be.revertedWithCustomError(sourceController, "Controller_ZeroAmount");
        });
        it("should burn only the bridged amount", async () => {
            const userBalanceBefore = await sourceToken.balanceOf(ownerSigner.address);
            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                destinationChainId,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );
            const userBalanceAfter = await sourceToken.balanceOf(ownerSigner.address);
            expect(userBalanceBefore.sub(userBalanceAfter)).to.be.equal(amountToBridge);
        });
        it("should not transfer tokens to treasury or strand them in the controller", async () => {
            const treasuryBalanceBefore = await sourceToken.balanceOf(treasuryAddress);
            const controllerBalanceBefore = await sourceToken.balanceOf(sourceController.address);

            await sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                ownerSigner.address,
                amountToBridge,
                false,
                destinationChainId,
                [sourceBridgeAdapter.address, source2BridgeAdapter.address],
                [relayerFee, relayerFee],
                [bridgeOptions, bridgeOptions],
                {
                    value: relayerFee.mul(2),
                }
            );

            const treasuryBalanceAfter = await sourceToken.balanceOf(treasuryAddress);
            const controllerBalanceAfter = await sourceToken.balanceOf(sourceController.address);
            expect(treasuryBalanceAfter).to.be.equal(treasuryBalanceBefore);
            expect(controllerBalanceAfter).to.be.equal(controllerBalanceBefore);
        });
        it("should revert if the adapters provided are less than minBridges", async () => {
            await expect(
                sourceController["transferTo(address,uint256,bool,uint256,address[],uint256[],bytes[])"](
                    ownerSigner.address,
                    amountToBridge,
                    false,
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                    destinationChainId,
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
                destinationChainId,
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
                destinationChainId,
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
                sourceChainId,
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
            await destController.setControllerForChain([sourceChainId], [ethers.constants.AddressZero]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should revert if originChain is not configured", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, amountToBridge, false, 1, transferId);
            await expect(destController.receiveMessage(forgedTransfer, 999, ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                destController,
                "Controller_Invalid_Params"
            );
        });
        it("should revert if a single-bridge caller is not approved", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, amountToBridge, false, 1, transferId);
            await expect(
                destController.connect(user1Signer).receiveMessage(forgedTransfer, sourceChainId, sourceController.address)
            ).to.be.revertedWithCustomError(destController, "Controller_AdapterNotSupported");

            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.amount).to.be.equal(0);
            expect(receivedTransfer.receivedSoFar).to.be.equal(0);
            expect(receivedTransfer.executed).to.be.equal(false);
        });
        it("should reject a trusted single-bridge delivery if the payload no longer matches the transfer id", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, BigNumber.from(0), false, 1, transferId);

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });

            const forgedRequestId = await connext.counter();
            await expect(connext.callXReceive(forgedRequestId)).to.be.revertedWithCustomError(destController, "Controller_InvalidTransferId");
        });
        it("should reject a trusted single-bridge delivery that targets a different destination chain", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const wrongDestChainId = sourceChainId + 1;
            const forgedTransferId = await sourceController.calculateTransferId(
                wrongDestChainId,
                relayedTransfer.nonce,
                relayedTransfer.recipient,
                relayedTransfer.amount,
                relayedTransfer.unwrap,
                relayedTransfer.threshold
            );
            const forgedTransfer = encodeTransfer(
                relayedTransfer.nonce,
                wrongDestChainId,
                relayedTransfer.recipient,
                relayedTransfer.amount,
                relayedTransfer.unwrap,
                relayedTransfer.threshold,
                forgedTransferId
            );

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });

            const forgedRequestId = await connext.counter();
            await expect(connext.callXReceive(forgedRequestId)).to.be.revertedWithCustomError(destController, "Controller_InvalidTransferId");
        });
        it("should reject a poison attempt and still allow the legitimate single-bridge delivery", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, amountToBridge, false, 1, transferId);
            await expect(
                destController.connect(user1Signer).receiveMessage(forgedTransfer, sourceChainId, sourceController.address)
            ).to.be.revertedWithCustomError(destController, "Controller_AdapterNotSupported");

            await connext.callXReceive(1);

            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.amount).to.be.equal(amountToBridge);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);
            expect(receivedTransfer.executed).to.be.equal(true);
        });
        it("should revert if an executed transaction is resent", async () => {
            await connext.callXReceive(1);
            // resend transfer via another bridge
            await sourceController["resendTransfer(bytes32,address,bytes)"](transferId, source2BridgeAdapter.address, bridgeOptions, {
                value: relayerFee,
            });

            await expect(connext2.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_TransferNotExecutable");
        });
        it("should reject replay for executed single-bridge transfers even when amount is zero", async () => {
            const forgedNonce = 777777;
            const zeroAmount = BigNumber.from(0);
            const forgedTransferId = await sourceController.calculateTransferId(
                sourceChainId,
                forgedNonce,
                user1Signer.address,
                zeroAmount,
                false,
                1
            );
            const forgedTransfer = encodeTransfer(forgedNonce, sourceChainId, user1Signer.address, zeroAmount, false, 1, forgedTransferId);

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });
            await connext.callXReceive(2);

            await sourceController.relayArbitraryMessage(source2BridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });
            await expect(connext2.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_TransferNotExecutable");
        });
        it("should revert if the contract is paused", async () => {
            await destController.pause();
            await expect(connext.callXReceive(1)).to.be.revertedWith("Pausable: paused");
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
            expect(receivedTransfer.originChainId).to.be.equal(sourceChainId);
            expect(receivedTransfer.receivedSoFar).to.be.equal(1);
            expect(receivedTransfer.threshold).to.be.equal(1);
            expect(receivedTransfer.executed).to.be.equal(true);
        });
        it("should emit an TransferReceived event", async () => {
            const tx = await connext.callXReceive(1);
            await expect(tx).to.emit(destController, "TransferReceived").withArgs(transferId, sourceChainId, destBridgeAdapter.address);
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
                sourceChainId,
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
        it("should deliver xerc20 and keep controller unstuck if lockbox is removed after unwrapping is enabled", async () => {
            // Unwrapping is enabled in beforeEach with a valid non-native lockbox.
            // Then governance removes the lockbox before message delivery.
            await destToken.setLockbox(ethers.constants.AddressZero);

            const bridgeTax = await destToken.calculateBridgeTax(amountToBridge);
            const userNativeBalanceBefore = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceBefore = await destToken.balanceOf(user1Signer.address);
            const controllerBalanceBefore = await destToken.balanceOf(destController.address);

            await connext.callXReceive(1);

            const userNativeBalanceAfter = await nativeToken.balanceOf(user1Signer.address);
            const userBalanceAfter = await destToken.balanceOf(user1Signer.address);
            const controllerBalanceAfter = await destToken.balanceOf(destController.address);
            const receivedTransfer = await destController.receivedTransfers(transferId);

            expect(userBalanceAfter).to.be.equal(amountToBridge.add(userBalanceBefore).sub(bridgeTax));
            expect(userNativeBalanceAfter).to.be.equal(userNativeBalanceBefore);
            expect(controllerBalanceAfter).to.be.equal(controllerBalanceBefore);
            expect(receivedTransfer.executed).to.be.equal(true);
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
                sourceChainId,
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
            await destController.setControllerForChain([sourceChainId], [ethers.constants.AddressZero]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should revert if the multibridge adapter that delivered the message is not registered", async () => {
            await destController.setMultiBridgeAdapters([destBridgeAdapter.address], [false]);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_AdapterNotSupported");
        });
        it("should revert if a multi-bridge caller is not approved", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, amountToBridge, false, 2, transferId);
            await expect(
                destController.connect(user1Signer).receiveMessage(forgedTransfer, sourceChainId, sourceController.address)
            ).to.be.revertedWithCustomError(destController, "Controller_AdapterNotSupported");

            const receivedTransfer = await destController.receivedTransfers(transferId);
            expect(receivedTransfer.amount).to.be.equal(0);
            expect(receivedTransfer.receivedSoFar).to.be.equal(0);
            expect(receivedTransfer.executed).to.be.equal(false);
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
        it("should revert if local multi-bridge transfers are disabled", async () => {
            await destController.setMinBridges(0);
            await expect(connext.callXReceive(1)).to.be.revertedWithCustomError(destController, "Controller_MultiBridgeTransfersDisabled");
        });
        it("should mark the transfer as delivered by the specific adapter", async () => {
            await connext.callXReceive(1);
            const deliveredBy = await destController.deliveredBy(transferId, destBridgeAdapter.address);
            expect(deliveredBy).to.be.equal(true);
        });
        it("should reject a trusted multi-bridge delivery if the payload no longer matches the transfer id", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, BigNumber.from(0), false, 2, transferId);

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });

            const forgedRequestId = await connext.counter();
            await expect(connext.callXReceive(forgedRequestId)).to.be.revertedWithCustomError(destController, "Controller_InvalidTransferId");
        });
        it("should reject a trusted multi-bridge delivery that tries to lower the threshold under the same transfer id", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransfer = encodeTransfer(relayedTransfer.nonce, sourceChainId, user1Signer.address, amountToBridge, false, 1, transferId);

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });

            const forgedRequestId = await connext.counter();
            await expect(connext.callXReceive(forgedRequestId)).to.be.revertedWithCustomError(destController, "Controller_InvalidTransferId");
        });
        it("should reject a trusted multi-bridge delivery that targets a different destination chain", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const wrongDestChainId = sourceChainId + 1;
            const forgedTransferId = await sourceController.calculateTransferId(
                wrongDestChainId,
                relayedTransfer.nonce,
                relayedTransfer.recipient,
                relayedTransfer.amount,
                relayedTransfer.unwrap,
                relayedTransfer.threshold
            );
            const forgedTransfer = encodeTransfer(
                relayedTransfer.nonce,
                wrongDestChainId,
                relayedTransfer.recipient,
                relayedTransfer.amount,
                relayedTransfer.unwrap,
                relayedTransfer.threshold,
                forgedTransferId
            );

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });

            const forgedRequestId = await connext.counter();
            await expect(connext.callXReceive(forgedRequestId)).to.be.revertedWithCustomError(destController, "Controller_InvalidTransferId");
        });
        it("should keep forged multi-bridge variants isolated and still allow the honest transfer to execute", async () => {
            const relayedTransfer = await sourceController.relayedTransfers(transferId);
            const forgedTransferId = await sourceController.calculateTransferId(
                sourceChainId,
                relayedTransfer.nonce,
                user1Signer.address,
                BigNumber.from(0),
                false,
                2
            );
            const forgedTransfer = encodeTransfer(
                relayedTransfer.nonce,
                sourceChainId,
                user1Signer.address,
                BigNumber.from(0),
                false,
                2,
                forgedTransferId
            );

            await sourceController.relayArbitraryMessage(sourceBridgeAdapter.address, sourceChainId, bridgeOptions, forgedTransfer, {
                value: relayerFee,
            });
            await connext.callXReceive(await connext.counter());

            const forgedReceipt = await destController.receivedTransfers(forgedTransferId);
            expect(forgedReceipt.amount).to.be.equal(0);
            expect(forgedReceipt.receivedSoFar).to.be.equal(1);
            expect(forgedReceipt.threshold).to.be.equal(2);
            expect(forgedReceipt.executed).to.be.equal(false);

            await connext.callXReceive(1);
            await connext2.callXReceive(1);

            const honestReceipt = await destController.receivedTransfers(transferId);
            expect(honestReceipt.amount).to.be.equal(amountToBridge);
            expect(honestReceipt.receivedSoFar).to.be.equal(2);

            await expect(destController.execute(transferId)).to.not.be.reverted;
            expect((await destController.receivedTransfers(forgedTransferId)).executed).to.be.equal(false);
        });
        describe("receiveMessage - first receipt", () => {
            beforeEach(async () => {});

            it("should store the executed transfer", async () => {
                await connext.callXReceive(1);
                const multiBridgeFeeAmount = BigNumber.from(amountToBridge.mul(multiBridgeFee).div(100000));

                const receivedTransfer = await destController.receivedTransfers(transferId);
                expect(receivedTransfer.amount).to.be.equal(amountToBridge);
                expect(receivedTransfer.recipient).to.be.equal(user1Signer.address);
                expect(receivedTransfer.originChainId).to.be.equal(sourceChainId);
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
                expect(receivedTransfer.originChainId).to.be.equal(sourceChainId);
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
                destinationChainId,
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
        it("should revert if local multi-bridge transfers are disabled before execution", async () => {
            await connext2.callXReceive(1);
            await destController.setMinBridges(0);
            await expect(destController.execute(transferId)).to.be.revertedWithCustomError(destController, "Controller_MultiBridgeTransfersDisabled");
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
                destinationChainId,
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
                destinationChainId,
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
                    destinationChainId,
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
            it("should revert when enabling unwrapping", async () => {
                await expect(destController.setTokenUnwrapping(true)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
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
                    destinationChainId,
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
            it("should revert when enabling unwrapping", async () => {
                // change lockbox address to zero
                await destToken.setLockbox(ethers.constants.AddressZero);
                await expect(destController.setTokenUnwrapping(true)).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
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
                    destinationChainId,
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
                    destinationChainId,
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
        it("should revert if minBridges is set to 1", async () => {
            await expect(destController.connect(ownerSigner).setMinBridges(1)).to.be.revertedWithCustomError(
                destController,
                "Controller_Invalid_Params"
            );
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
    describe("setTransferSenders", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setTransferSenders([user1Signer.address], [true])).to.be.reverted;
        });
        it("should set transfer sender whitelist entries", async () => {
            await destController.connect(ownerSigner).setTransferSenders([user1Signer.address], [true]);
            expect(await destController.transferSenders(user1Signer.address)).to.equal(true);
        });
        it("should revert if the arrays are not the same length", async () => {
            await expect(destController.connect(ownerSigner).setTransferSenders([user1Signer.address], [true, false])).to.be.revertedWithCustomError(
                destController,
                "Controller_Invalid_Params"
            );
        });
        it("should emit a TransferSenderSet event", async () => {
            const tx = await destController.connect(ownerSigner).setTransferSenders([user1Signer.address], [true]);
            await expect(tx).to.emit(destController, "TransferSenderSet").withArgs(user1Signer.address, true);
        });
    });
    describe("setTransferSenderWhitelistEnabled", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setTransferSenderWhitelistEnabled(false)).to.be.reverted;
        });
        it("should set whitelist enforcement", async () => {
            await destController.connect(ownerSigner).setTransferSenderWhitelistEnabled(false);
            expect(await destController.transferSenderWhitelistEnabled()).to.equal(false);
        });
        it("should emit a TransferSenderWhitelistSet event", async () => {
            const tx = await destController.connect(ownerSigner).setTransferSenderWhitelistEnabled(false);
            await expect(tx).to.emit(destController, "TransferSenderWhitelistSet").withArgs(false);
        });
    });
    describe("setTokenUnwrapping", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setTokenUnwrapping(true)).to.be.reverted;
        });
        it("should revert when enabling unwrapping with a native lockbox", async () => {
            const Lockbox = await ethers.getContractFactory("XERC20Lockbox");
            const nativeLockbox = await Lockbox.deploy(destToken.address, nativeToken.address, true);
            await destToken.setLockbox(nativeLockbox.address);

            await expect(destController.connect(ownerSigner).setTokenUnwrapping(true)).to.be.revertedWithCustomError(
                destController,
                "Controller_Invalid_Params"
            );
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
        it("should emit a Withdrawal event", async () => {
            const amount = await ethers.provider.getBalance(sourceController.address);
            const tx = await sourceController.connect(ownerSigner).withdraw(user1Signer.address);
            await expect(tx).to.emit(sourceController, "Withdrawal").withArgs(user1Signer.address, amount);
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
