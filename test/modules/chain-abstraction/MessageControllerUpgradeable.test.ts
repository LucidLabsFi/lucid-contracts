import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("MessageControllerUpgradeable Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let whitelistedSigner: SignerWithAddress;
    let treasury: SignerWithAddress;
    let vetoer: SignerWithAddress;
    let pauser: SignerWithAddress;
    let treasuryAddress: string;
    let sourceController: Contract;
    let destController: Contract;
    let registry: Contract;
    let connext: Contract;
    let connext2: Contract;
    let counter: Contract;
    let messageId: string;
    let relayerFee: BigNumber;
    let sourceBridgeAdapter: Contract;
    let destBridgeAdapter: Contract;
    let sourceBridgeAdapter2: Contract;
    let destBridgeAdapter2: Contract;
    let bridgeOptions: any;

    const protocolFee = 5000;
    const relayerFeeThreshold = ethers.utils.parseEther("0.0001");
    const timelockDelay = 60 * 60 * 12; // 12 hours from message seen
    const bridgeGasLimit = 2000000; // used in Wormhole and Hyperlane adapters as the gas limit the transaction will consume on destination

    beforeEach(async () => {
        [ownerSigner, user1Signer, whitelistedSigner, treasury, vetoer, pauser] = await ethers.getSigners();
        // upgrades.silenceWarnings();
        treasuryAddress = treasury.address;

        // Chain 50 - sourceController, sourceBridgeAdapter, sourceBridgeAdapter2
        // Chain 100 - destController, destBridgeAdapter, destBridgeAdapter2, MockCounter

        // Deploy Mock connext contract
        const Connext = await ethers.getContractFactory("ConnextMock");
        connext = await Connext.deploy();
        connext2 = await Connext.deploy();

        // Deploy Source MessageControllerUpgradeable contract
        const Controller = await ethers.getContractFactory("MessageControllerUpgradeable");
        destController = await upgrades.deployProxy(
            Controller,
            [
                [whitelistedSigner.address],
                ethers.constants.AddressZero,
                [],
                [],
                ethers.constants.AddressZero,
                vetoer.address,
                timelockDelay,
                [ownerSigner.address, pauser.address],
            ],
            {
                initializer: "initialize",
            }
        );
        await destController.deployed();

        // Deploy Destination MessageControllerUpgradeable contract
        sourceController = await upgrades.deployProxy(
            Controller,
            [
                [whitelistedSigner.address],
                ethers.constants.AddressZero,
                [],
                [],
                ethers.constants.AddressZero,
                vetoer.address,
                timelockDelay,
                [ownerSigner.address, pauser.address],
            ],
            {
                initializer: "initialize",
            }
        );
        await sourceController.deployed();

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

        sourceBridgeAdapter2 = await BridgeAdapter.deploy(
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
        destBridgeAdapter2 = await BridgeAdapter.deploy(
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
        await sourceBridgeAdapter2.setTrustedAdapter(100, destBridgeAdapter2.address);
        await destBridgeAdapter2.setTrustedAdapter(50, sourceBridgeAdapter2.address);

        // Call setLocalAdapter on Source and Dest Controller to register Bridge Adapter
        await sourceController.connect(ownerSigner).setLocalAdapter([sourceBridgeAdapter.address, sourceBridgeAdapter2.address], [true, true]);
        await destController.connect(ownerSigner).setLocalAdapter([destBridgeAdapter.address, destBridgeAdapter2.address], [true, true]);

        // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
        await sourceController.setControllerForChain([100], [destController.address]);
        await destController.setControllerForChain([50], [sourceController.address]);

        // Set domain Id for adapter contract, applycable to Connext adapters
        await sourceBridgeAdapter.setDomainId([50], [500]);
        await destBridgeAdapter.setDomainId([100], [1000]);
        await sourceBridgeAdapter.setDomainId([100], [1000]);
        await destBridgeAdapter.setDomainId([50], [500]);

        // set origin domain id in Mock Connext contract
        await connext.setOriginDomainId(sourceBridgeAdapter.address, 500); // domain id of the same chain of source adapter
        await connext.setOriginDomainId(destBridgeAdapter.address, 1000); // domain id of the same chain of dest adapter
        await connext2.setOriginDomainId(sourceBridgeAdapter2.address, 500); // domain id of the same chain of source adapter
        await connext2.setOriginDomainId(destBridgeAdapter2.address, 1000); // domain id of the same chain of dest adapter
    });
    describe("initialize", () => {
        beforeEach(async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([], ownerSigner.address);
            await registry.deployed();

            const Controller = await ethers.getContractFactory("MessageControllerUpgradeable");
            destController = await upgrades.deployProxy(
                Controller,
                [
                    [whitelistedSigner.address],
                    registry.address,
                    [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                    [500],
                    sourceController.address,
                    vetoer.address,
                    timelockDelay,
                    [user1Signer.address, pauser.address],
                ],
                {
                    initializer: "initialize",
                }
            );
            await destController.deployed();
        });
        it("should set the message originators", async () => {
            expect(await destController.hasRole(await destController.MESSAGE_ORIGINATOR_ROLE(), whitelistedSigner.address)).to.equal(true);
            expect(await destController.hasRole(await destController.MESSAGE_ORIGINATOR_ROLE(), user1Signer.address)).to.equal(false);
            expect(await destController.hasRole(await destController.MESSAGE_ORIGINATOR_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the MESSAGE_RESENDER_ROLE to the message originators", async () => {
            expect(await destController.hasRole(await destController.MESSAGE_RESENDER_ROLE(), whitelistedSigner.address)).to.equal(true);
            expect(await destController.hasRole(await destController.MESSAGE_RESENDER_ROLE(), user1Signer.address)).to.equal(false);
            expect(await destController.hasRole(await destController.MESSAGE_RESENDER_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should set the local registry", async () => {
            expect(await destController.localRegistry()).to.equal(registry.address);
        });
        it("should set the local adapters", async () => {
            expect(await destController.isLocalAdapter(sourceBridgeAdapter.address)).to.equal(true);
            expect(await destController.isLocalAdapter(sourceBridgeAdapter2.address)).to.equal(true);
        });
        it("should set the vetoer", async () => {
            expect(await destController.vetoer()).to.equal(vetoer.address);
        });
        it("should set the timelock delay", async () => {
            expect(await destController.timelockDelay()).to.equal(timelockDelay);
        });
        it("should set the owner to user1", async () => {
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), user1Signer.address)).to.equal(true);
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), whitelistedSigner.address)).to.equal(false);
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the PAUSE_ROLE to user1", async () => {
            expect(await destController.hasRole(await destController.PAUSE_ROLE(), user1Signer.address)).to.equal(true);
            expect(await destController.hasRole(await destController.PAUSE_ROLE(), whitelistedSigner.address)).to.equal(false);
            expect(await destController.hasRole(await destController.PAUSE_ROLE(), ownerSigner.address)).to.equal(false);
        });
        it("should give the PAUSE_ROLE to pauser", async () => {
            expect(await destController.hasRole(await destController.PAUSE_ROLE(), pauser.address)).to.equal(true);
            expect(await destController.hasRole(await destController.DEFAULT_ADMIN_ROLE(), pauser.address)).to.equal(false);
        });
        it("should set the controllerForChain ", async () => {
            expect(await destController.getControllerForChain(500)).to.equal(sourceController.address);
        });
    });
    describe("sendMessage", () => {
        beforeEach(async () => {
            // await helpers.time.increase(2000);
            relayerFee = ethers.utils.parseEther("0.01");
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
        });
        it("should revert if msg.sender is not messageOriginator", async () => {
            const messageOriginatorRole = await sourceController.MESSAGE_ORIGINATOR_ROLE();
            await expect(
                sourceController
                    .connect(user1Signer)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [], ethers.constants.HashZero, 3],
                        100,
                        [sourceBridgeAdapter.address],
                        [relayerFee],
                        [bridgeOptions],
                        {value: relayerFee}
                    )
            ).to.be.revertedWith(`AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${messageOriginatorRole}`);
        });
        it("should revert if the threshold specified is smaller than the adapters ", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [], ethers.constants.HashZero, 1],
                        100,
                        [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                        [relayerFee, relayerFee],
                        [bridgeOptions, bridgeOptions],
                        {value: relayerFee.mul(2)}
                    )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the targets and calldatas arrays don't have the same length ", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [], ethers.constants.HashZero, 1],
                        100,
                        [sourceBridgeAdapter.address],
                        [relayerFee],
                        [bridgeOptions],
                        {value: relayerFee}
                    )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the fee and adapters arrays don't have the same length ", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                        100,
                        [sourceBridgeAdapter.address],
                        [relayerFee, relayerFee],
                        [bridgeOptions],
                        {value: relayerFee.mul(2)}
                    )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the options and adapters arrays don't have the same length ", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                        100,
                        [sourceBridgeAdapter.address],
                        [relayerFee],
                        [bridgeOptions, bridgeOptions],
                        {value: relayerFee.mul(2)}
                    )
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the contract is paused ", async () => {
            await sourceController.connect(ownerSigner).pause();
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                        100,
                        [sourceBridgeAdapter.address],
                        [relayerFee],
                        [bridgeOptions],
                        {value: relayerFee}
                    )
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should emit a MessageRelayed event with the messageId and the bridge", async () => {
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            await expect(tx).to.emit(sourceController, "MessageRelayed");

            const event = (await tx.wait()).events?.find((x: any) => x.event === "MessageRelayed")?.args;
            expect(event.bridge).to.be.equal(sourceBridgeAdapter.address);
        });
        it("should emit a MessageCreated event", async () => {
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            await expect(tx).to.emit(sourceController, "MessageCreated");

            const event = (await tx.wait()).events?.find((x: any) => x.event === "MessageCreated")?.args;
            expect(event.chainId).to.be.equal(100);
            expect(event.threshold).to.be.equal(1);
        });
        it("should create and emit the messageId", async () => {
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            const receipt = await tx.wait();
            const msgRelayedEvent = receipt.events?.find((x: any) => x.event === "MessageRelayed");
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");

            expect(msgCreatedEvent?.args?.messageId).to.be.equal(msgRelayedEvent?.args?.messageId);
        });
        it("should increase the controller's nonce", async () => {
            expect(await sourceController.nonce()).to.be.equal(0);

            await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            expect(await sourceController.nonce()).to.be.equal(1);
        });
        it("should call the adapter", async () => {
            expect(await connext.counter()).to.be.equal(0);
            await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            expect(await connext.counter()).to.be.equal(1);
        });
        describe("sendMessage - multiple adapters", () => {
            it("should emit multiple MessageRelayed events", async () => {
                await expect(
                    sourceController
                        .connect(whitelistedSigner)
                        .sendMessage(
                            [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                            100,
                            [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                            [relayerFee, relayerFee],
                            [bridgeOptions, bridgeOptions],
                            {value: relayerFee.mul(2)}
                        )
                )
                    .to.emit(sourceController, "MessageRelayed")
                    .withArgs(anyValue, sourceBridgeAdapter.address)
                    .to.emit(sourceController, "MessageRelayed")
                    .withArgs(anyValue, sourceBridgeAdapter2.address);
            });
        });
    });
    describe("isSenderApproved", () => {
        let registry: Contract;

        beforeEach(async () => {
            // Deploy a mock Registry contract
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([sourceBridgeAdapter.address, sourceBridgeAdapter2.address], ownerSigner.address);
            await registry.deployed();
        });
        it("should return true if sender is approved in local storage and no local registry is set", async () => {
            await sourceController.setLocalAdapter([ownerSigner.address], [true]);

            const isApproved = await sourceController.isSenderApproved(ownerSigner.address);
            expect(isApproved).to.be.true;
        });

        it("should return false if sender is not approved in local storage and no local registry is set", async () => {
            await sourceController.setLocalAdapter([ownerSigner.address], [false]);

            const isApproved = await sourceController.isSenderApproved(ownerSigner.address);
            expect(isApproved).to.be.false;
        });
        it("should return true for sender approved in the registry", async () => {
            expect(await sourceController.isSenderApproved(ownerSigner.address)).to.be.false;

            // Set the local registry
            await sourceController.setLocalRegistry(registry.address);

            await registry.setAdapters([user1Signer.address], [true]);

            const isApproved = await sourceController.isSenderApproved(user1Signer.address);
            expect(isApproved).to.be.true;
        });
        it("should return false for sender not approved in the registry", async () => {
            expect(await sourceController.isSenderApproved(ownerSigner.address)).to.be.false;

            // Set the local registry
            await sourceController.setLocalRegistry(registry.address);

            await registry.setAdapters([user1Signer.address], [false]);

            const isApproved = await sourceController.isSenderApproved(user1Signer.address);
            expect(isApproved).to.be.false;
        });
        it("should return false if sender is not approved in the registry but approved locally", async () => {
            // Set the local registry
            await sourceController.setLocalRegistry(registry.address);

            await registry.setAdapters([user1Signer.address], [false]);
            await sourceController.setLocalAdapter([user1Signer.address], [true]);

            const isApproved = await sourceController.isSenderApproved(user1Signer.address);
            expect(isApproved).to.be.false;
        });
        it("should return true if sender is approved in the registry but not approved locally", async () => {
            // Set the local registry
            await sourceController.setLocalRegistry(registry.address);

            await registry.setAdapters([user1Signer.address], [true]);
            await sourceController.setLocalAdapter([user1Signer.address], [false]);

            const isApproved = await sourceController.isSenderApproved(user1Signer.address);
            expect(isApproved).to.be.true;
        });
    });
    describe("resendMessage", () => {
        beforeEach(async () => {
            // Deploy Mock counter contract
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);

            await destController.connect(ownerSigner).setTimelockDelay(0);

            relayerFee = ethers.utils.parseEther("0.013");
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should resend a message using a different adapter, marking contract as executable", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
            await sourceController
                .connect(whitelistedSigner)
                .resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                });
            await connext2.callXReceive(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.true;
        });
        it("should emit a MessageResent event", async () => {
            await expect(
                sourceController.connect(whitelistedSigner).resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                })
            )
                .to.emit(sourceController, "MessageResent")
                .withArgs(messageId);
        });
        it("should not revert if the caller doesn't have the message originator role but has the message resender role", async () => {
            await sourceController.revokeRole(await sourceController.MESSAGE_ORIGINATOR_ROLE(), whitelistedSigner.address);
            await expect(
                sourceController.connect(whitelistedSigner).resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                })
            ).to.emit(sourceController, "MessageResent");
        });
        it("should revert if the caller doesn't have the message resender role", async () => {
            const messageResenderRole = await sourceController.MESSAGE_RESENDER_ROLE();
            await sourceController.revokeRole(messageResenderRole, whitelistedSigner.address);

            await expect(
                sourceController.connect(whitelistedSigner).resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                })
            ).to.be.revertedWith(`AccessControl: account ${whitelistedSigner.address.toLowerCase()} is missing role ${messageResenderRole}`);
        });
        it("should revert if an unknown messageId is provided", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .resendMessage(ethers.utils.randomBytes(32), [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                        value: relayerFee,
                    })
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should revert if the contract is paused ", async () => {
            await sourceController.connect(ownerSigner).pause();
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .resendMessage(ethers.utils.randomBytes(32), [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                        value: relayerFee,
                    })
            ).to.be.revertedWith("Pausable: paused");
        });
        it("should revert if the options and adapters array length are different ", async () => {
            await expect(
                sourceController
                    .connect(whitelistedSigner)
                    .resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions, bridgeOptions], {
                        value: relayerFee,
                    })
            ).to.be.revertedWithCustomError(sourceController, "Controller_Invalid_Params");
        });
        it("should emit a MessageRelayed event", async () => {
            await expect(
                sourceController.connect(whitelistedSigner).resendMessage(messageId, [sourceBridgeAdapter2.address], [relayerFee], [bridgeOptions], {
                    value: relayerFee,
                })
            )
                .to.emit(sourceController, "MessageRelayed")
                .withArgs(messageId, sourceBridgeAdapter2.address);
        });
        describe("resending using the same bridge", () => {
            it("should not be able to resend a message using the same bridge that already delivered it", async () => {
                // Deploy Mock counter contract
                const Counter = await ethers.getContractFactory("CounterMock");
                counter = await Counter.deploy();
                const ABI = ["function increment()"];
                const iface = new ethers.utils.Interface(ABI);
                const calldata = iface.encodeFunctionData("increment", []);
                const connextBridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);

                const tx = await sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[counter.address], [calldata], ethers.constants.HashZero, 2],
                        100,
                        [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                        [relayerFee, relayerFee],
                        [connextBridgeOptions, bridgeOptions],
                        {
                            value: relayerFee.mul(2),
                        }
                    );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
                messageId = msgCreatedEvent?.args?.messageId;

                await connext.callXReceive(2);
                let receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.receivedSoFar).to.be.equal(1);
                // resend message again
                await sourceController
                    .connect(whitelistedSigner)
                    .resendMessage(messageId, [sourceBridgeAdapter.address], [relayerFee], [connextBridgeOptions], {
                        value: relayerFee,
                    });
                await expect(connext.callXReceive(3)).to.be.revertedWithCustomError(destController, "Controller_MessageResentByAadapter");
            });
        });
    });
    describe("receiveMessage", () => {
        beforeEach(async () => {
            // Deploy Mock counter contract
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            relayerFee = ethers.utils.parseEther("0.013");
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);

            await destController.connect(ownerSigner).setTimelockDelay(0);

            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should revert if the message is not senderApproved", async () => {
            await expect(
                destController.connect(user1Signer).receiveMessage(ethers.utils.randomBytes(32), 50, sourceController.address)
            ).to.be.revertedWithCustomError(destController, "Controller_Unauthorised");
        });
        it("should revert if origin sender is not a controller ", async () => {
            // Set an approved sender to bypass previous check
            await destController.connect(ownerSigner).setLocalAdapter([whitelistedSigner.address], [true]);
            await expect(
                destController.connect(whitelistedSigner).receiveMessage(ethers.utils.randomBytes(32), 50, sourceBridgeAdapter.address)
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        describe("message id doesn't exist, instant execution", () => {
            beforeEach(async () => {});
            it("should mark the message as executable", async () => {
                await connext.callXReceive(1);

                expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
            });
            it("should record 1 receipt", async () => {
                await connext.callXReceive(1);
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.receivedSoFar).to.be.equal(1);
            });
            it("should set an expiration date ", async () => {
                const expiryInSeconds = await destController.MESSAGE_EXPIRY();
                await connext.callXReceive(1);

                const currentTime = await helpers.time.latest();
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.expiresAt).to.be.equal(currentTime + expiryInSeconds.toNumber());
            });
            it("should set executableAt", async () => {
                await connext.callXReceive(1);

                const currentTime = await helpers.time.latest();
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.executableAt).to.be.equal(currentTime);
            });
            it("should set executableAt with a timelock delay ", async () => {
                await destController.connect(ownerSigner).setTimelockDelay(1000);

                await connext.callXReceive(1);

                const currentTime = await helpers.time.latest();
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.executableAt).to.be.equal(currentTime + 1000);
            });
            it("should record the origin chain id", async () => {
                await connext.callXReceive(1);
                await destController.execute(messageId);

                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.originChainId).to.be.equal(50);
            });
            it("should record the executed and cancelled status", async () => {
                await connext.callXReceive(1);
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.executed).to.be.equal(false);
                expect(receivedMessage.cancelled).to.be.equal(false);
            });
            it("should emit a MessageReceived event", async () => {
                await expect(connext.callXReceive(1)).to.emit(destController, "MessageReceived").withArgs(messageId, destBridgeAdapter.address);
            });
            it("should emit a MessageExecutableAt event", async () => {
                await expect(connext.callXReceive(1)).to.emit(destController, "MessageExecutableAt").withArgs(messageId, anyValue);
            });
        });

        describe("message id exists, increase threshold", () => {
            beforeEach(async () => {
                // Structure message to use 2 adapters with a 2-of-2 consensus to include hyperlane

                const ABI = ["function increment()"];
                const iface = new ethers.utils.Interface(ABI);
                const calldata = iface.encodeFunctionData("increment", []);
                relayerFee = ethers.utils.parseEther("0.013");
                const tx = await sourceController
                    .connect(whitelistedSigner)
                    .sendMessage(
                        [[counter.address], [calldata], ethers.constants.HashZero, 2],
                        100,
                        [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                        [relayerFee, relayerFee],
                        [bridgeOptions, bridgeOptions],
                        {
                            value: relayerFee.mul(2),
                        }
                    );

                const receipt = await tx.wait();
                const msgCreatedEvent = receipt.events?.filter((x: any) => {
                    return x.event == "MessageCreated";
                });
                messageId = msgCreatedEvent[0].args["messageId"];
                // Deliver message using first adapter
                await connext.callXReceive(2);
            });
            it("should not mark the message as executable", async () => {
                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.executed).to.be.false;
                expect(receivedMessage.executableAt).to.be.equal(0);
            });
            it("should record 2 receipts", async () => {
                await connext2.callXReceive(1);

                const receivedMessage = await destController.receivedMessages(messageId);
                expect(receivedMessage.receivedSoFar).to.be.equal(2);
            });
            it("should emit a MessageExecutableAt event", async () => {
                await expect(connext2.callXReceive(1)).to.emit(destController, "MessageExecutableAt").withArgs(messageId, anyValue);
            });
        });
    });
    describe("execute", () => {
        beforeEach(async () => {
            // Deploy Mock counter contract
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            relayerFee = ethers.utils.parseEther("0.013");
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);

            await destController.connect(ownerSigner).setTimelockDelay(0);

            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 1],
                    100,
                    [sourceBridgeAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {
                        value: relayerFee,
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should revert execution if contract is paused", async () => {
            await connext.callXReceive(1);
            await destController.connect(ownerSigner).pause();
            await expect(destController.execute(messageId)).to.be.revertedWith("Pausable: paused");
        });
        it("should emit a MessageExecuted event", async () => {
            await connext.callXReceive(1);
            await expect(destController.execute(messageId)).to.emit(destController, "MessageExecuted").withArgs(messageId);
        });
        it("should mark the message as executed", async () => {
            await connext.callXReceive(1);
            await destController.execute(messageId);
            expect((await destController.receivedMessages(messageId)).executed).to.be.equal(true);
        });
        it("should execute the message", async () => {
            await connext.callXReceive(1);
            expect(await counter.getCount()).to.be.equal(0);
            await destController.execute(messageId);
            expect(await counter.getCount()).to.be.equal(1);
        });
        it("should revert if the message is executed twice", async () => {
            await connext.callXReceive(1);
            await destController.execute(messageId);
            await expect(destController.execute(messageId)).to.be.revertedWithCustomError(destController, "Controller_MsgNotExecutable");
        });
        it("should revert if the message is cancelled", async () => {
            await connext.callXReceive(1);
            await destController.connect(vetoer).cancel(messageId);
            await expect(destController.execute(messageId)).to.be.revertedWithCustomError(destController, "Controller_MsgNotExecutable");
        });
        it("should revert if the message is within the timelock delay", async () => {
            await destController.connect(ownerSigner).setTimelockDelay(1000);
            await connext.callXReceive(1);

            await expect(destController.execute(messageId)).to.be.revertedWithCustomError(destController, "Controller_MsgNotExecutableYet");
        });
        it("should revert if the message is expired", async () => {
            await connext.callXReceive(1);
            const expiryInSeconds = await destController.MESSAGE_EXPIRY();
            await helpers.time.increase(expiryInSeconds);

            await expect(destController.execute(messageId)).to.be.revertedWithCustomError(destController, "Controller_MsgExpired");
        });

        it("should revert if the threshold is not met", async () => {
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 2],
                    100,
                    [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                    [relayerFee, relayerFee],
                    [bridgeOptions, bridgeOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
            await connext.callXReceive(2);
            await expect(destController.execute(messageId)).to.be.revertedWithCustomError(destController, "Controller_ThresholdNotMet");
        });
    });
    describe("setLocalAdapter", () => {
        it("should revert if adapters and enabled arrays have different lengths", async () => {
            const adapters = [ethers.Wallet.createRandom().address];
            const enabled = [true, false];

            await expect(sourceController.setLocalAdapter(adapters, enabled)).to.be.revertedWithCustomError(
                sourceController,
                "Controller_Invalid_Params"
            );
        });
        it("should update the local adapters correctly when called by the owner", async () => {
            const adapters = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
            const enabled = [true, false];

            await sourceController.setLocalAdapter(adapters, enabled);

            for (let i = 0; i < adapters.length; i++) {
                const isEnabled = await sourceController.isLocalAdapter(adapters[i]);
                expect(isEnabled).to.equal(enabled[i]);
            }
        });
        it("should revert when non-owner attempts to update the local adapters", async () => {
            const adapters = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
            const enabled = [true, false];

            await expect(sourceController.connect(user1Signer).setLocalAdapter(adapters, enabled)).to.be.reverted;
        });
        it("should emit AdapterSet events for each adapter updated", async () => {
            const adapters = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
            const enabled = [true, false];

            const tx = await sourceController.setLocalAdapter(adapters, enabled);

            for (let i = 0; i < adapters.length; i++) {
                await expect(tx).to.emit(sourceController, "LocalAdapterSet").withArgs(adapters[i], enabled[i]);
            }
        });
    });
    describe("setLocalRegistry", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setLocalRegistry(user1Signer.address)).to.be.reverted;
        });
        it("should set the local registry address correctly", async () => {
            await destController.connect(ownerSigner).setLocalRegistry(user1Signer.address);
            expect(await destController.localRegistry()).to.equal(user1Signer.address);
        });
        it("should emit a LocalRegistrySet event", async () => {
            const tx = await destController.connect(ownerSigner).setLocalRegistry(user1Signer.address);
            await expect(tx).to.emit(destController, "LocalRegistrySet").withArgs(user1Signer.address);
        });
    });
    describe("setMessageOriginators", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(destController.connect(whitelistedSigner).setMessageOriginators([user1Signer.address], [true])).to.be.reverted;
        });
        it("should revert if originator and enabled arrays have different lengths", async () => {
            await expect(
                destController.connect(ownerSigner).setMessageOriginators([user1Signer.address], [true, false])
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");

            await expect(
                destController.connect(ownerSigner).setMessageOriginators([user1Signer.address, ownerSigner.address], [true])
            ).to.be.revertedWithCustomError(destController, "Controller_Invalid_Params");
        });
        it("should set the message originator status correctly", async () => {
            const originators = [user1Signer.address, ownerSigner.address];
            const statuses = [true, false];

            await destController.connect(ownerSigner).setMessageOriginators(originators, statuses);
            const messageOriginatorRole = await destController.MESSAGE_ORIGINATOR_ROLE();
            for (let i = 0; i < originators.length; i++) {
                expect(await destController.hasRole(messageOriginatorRole, originators[i])).to.equal(statuses[i]);
            }
        });
        it("should emit MessageOriginatorSet and MessageResenderSet events", async () => {
            const originators = [user1Signer.address, ownerSigner.address];
            const statuses = [true, false];

            const tx = await destController.connect(ownerSigner).setMessageOriginators(originators, statuses);

            for (let i = 0; i < originators.length; i++) {
                await expect(tx).to.emit(destController, "MessageOriginatorSet").withArgs(originators[i], statuses[i]);
                await expect(tx).to.emit(destController, "MessageResenderSet").withArgs(originators[i], statuses[i]);
            }
        });
        it("should revoke the roles when setting the status to false", async () => {
            const originators = [user1Signer.address];
            const statuses = [true];

            await destController.connect(ownerSigner).setMessageOriginators(originators, statuses);
            const messageOriginatorRole = await destController.MESSAGE_ORIGINATOR_ROLE();
            const messageResenderRole = await destController.MESSAGE_RESENDER_ROLE();
            expect(await destController.hasRole(messageOriginatorRole, user1Signer.address)).to.equal(true);
            expect(await destController.hasRole(messageResenderRole, user1Signer.address)).to.equal(true);

            // Now set to false
            await destController.connect(ownerSigner).setMessageOriginators(originators, [false]);
            expect(await destController.hasRole(messageOriginatorRole, user1Signer.address)).to.equal(false);
            expect(await destController.hasRole(messageResenderRole, user1Signer.address)).to.equal(false);
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
        it("should emit a ControllerForChainSet event for each chain ID set", async () => {
            const randomController1 = ethers.Wallet.createRandom().address;
            const randomController2 = ethers.Wallet.createRandom().address;

            const tx = await destController.connect(ownerSigner).setControllerForChain([200, 300], [randomController1, randomController2]);

            await expect(tx).to.emit(destController, "ControllerForChainSet").withArgs(randomController1, 200);
            await expect(tx).to.emit(destController, "ControllerForChainSet").withArgs(randomController2, 300);
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
    describe("isReceivedMessageExecutable", () => {
        beforeEach(async () => {
            // Deploy Mock counter contract
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            await destController.connect(ownerSigner).setTimelockDelay(0);

            relayerFee = ethers.utils.parseEther("0.013");
            const connextOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
            const hlOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, bridgeGasLimit]);
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 2],
                    100,
                    [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                    [relayerFee, relayerFee],
                    [connextOptions, hlOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should return false if the message doesn't exist", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
        it("should return false if the message is not executable, threshold not met", async () => {
            await connext.callXReceive(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
        it("should return true if the message if threshold is met", async () => {
            await connext.callXReceive(1);
            await connext2.callXReceive(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.true;
        });
        it("should return false if the message has been executed already", async () => {
            await connext.callXReceive(1);
            await connext2.callXReceive(1);
            await destController.execute(messageId);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
        it("should return false if the message is not executable yet due to timelock delay", async () => {
            await destController.connect(ownerSigner).setTimelockDelay(1000);

            await connext.callXReceive(1);
            await connext2.callXReceive(1);

            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
        it("should return false if the message is not executable yet due to timelock delay, but timelock delay has passed since 1st message receipt", async () => {
            await destController.connect(ownerSigner).setTimelockDelay(1000);
            await connext.callXReceive(1);
            await helpers.time.increase(1000);
            //await connext2.callXReceive(1);

            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
        it("should return false if the message was cancelled", async () => {
            await connext.callXReceive(1);
            await connext2.callXReceive(1);

            await destController.connect(vetoer).cancel(messageId);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.false;
        });
    });
    describe("cancel", () => {
        beforeEach(async () => {
            // Deploy Mock counter contract
            const Counter = await ethers.getContractFactory("CounterMock");
            counter = await Counter.deploy();
            const ABI = ["function increment()"];
            const iface = new ethers.utils.Interface(ABI);
            const calldata = iface.encodeFunctionData("increment", []);

            await destController.connect(ownerSigner).setTimelockDelay(0);

            relayerFee = ethers.utils.parseEther("0.013");
            const connextOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
            const hlOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, bridgeGasLimit]);
            const tx = await sourceController
                .connect(whitelistedSigner)
                .sendMessage(
                    [[counter.address], [calldata], ethers.constants.HashZero, 2],
                    100,
                    [sourceBridgeAdapter.address, sourceBridgeAdapter2.address],
                    [relayerFee, relayerFee],
                    [connextOptions, hlOptions],
                    {
                        value: relayerFee.mul(2),
                    }
                );

            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should revert if caller is not vetoer", async () => {
            await connext.callXReceive(1);
            await expect(destController.connect(user1Signer).cancel(messageId)).to.be.reverted;
        });
        it("should revert if message has already been executed", async () => {
            await connext.callXReceive(1);
            await connext2.callXReceive(1);
            await destController.execute(messageId);

            await expect(destController.connect(vetoer).cancel(messageId)).to.be.revertedWithCustomError(
                destController,
                "Controller_MsgNotCancellable"
            );
        });
        it("should revert if message has already been cancelled", async () => {
            await connext.callXReceive(1);
            await connext2.callXReceive(1);

            await destController.execute(messageId);

            await expect(destController.connect(vetoer).cancel(messageId)).to.be.revertedWithCustomError(
                destController,
                "Controller_MsgNotCancellable"
            );
        });
        it("should mark a message as cancelled", async () => {
            await connext.callXReceive(1);
            await destController.connect(vetoer).cancel(messageId);
            expect((await destController.receivedMessages(messageId)).cancelled).to.be.equal(true);
        });
    });
    describe("setVetoer", () => {
        it("should revert if caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setVetoer(user1Signer.address)).to.be.reverted;
        });
        it("should set the vetoer address", async () => {
            await destController.connect(ownerSigner).setVetoer(user1Signer.address);
            expect(await destController.vetoer()).to.equal(user1Signer.address);
        });
        it("should emit a VetoerSet event", async () => {
            const tx = await destController.connect(ownerSigner).setVetoer(user1Signer.address);
            await expect(tx).to.emit(destController, "VetoerSet").withArgs(user1Signer.address);
        });
    });
    describe("setTimelockDelay", () => {
        it("should revert if caller is not the owner", async () => {
            await expect(destController.connect(user1Signer).setTimelockDelay(100)).to.be.reverted;
        });
        it("should set the timelock delay", async () => {
            await destController.connect(ownerSigner).setTimelockDelay(100);
            expect(await destController.timelockDelay()).to.equal(100);
        });
        it("should emit a TimelockDelaySet event", async () => {
            const tx = await destController.connect(ownerSigner).setTimelockDelay(100);
            await expect(tx).to.emit(destController, "TimelockDelaySet").withArgs(100);
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
        it("should revert if message originator attempts to grant message originator roles", async () => {
            const messageOriginatorRole = await destController.MESSAGE_ORIGINATOR_ROLE();
            await expect(destController.connect(whitelistedSigner).grantRole(messageOriginatorRole, user1Signer.address)).to.be.reverted;
        });
        it("should revert if message resender attempts to grant message resender roles", async () => {
            const messageResender = await destController.MESSAGE_RESENDER_ROLE();
            await expect(destController.connect(whitelistedSigner).grantRole(messageResender, user1Signer.address)).to.be.reverted;
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
