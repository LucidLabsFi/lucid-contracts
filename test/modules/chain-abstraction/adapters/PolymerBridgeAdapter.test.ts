import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("PolymerBridgeAdapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let adapter: Contract;
    let destController: Contract;
    let sourceController: Contract;
    let counter: Contract;
    let proverMock: Contract;
    let minGas: BigNumber;
    let messageId: any;
    let bridgeOptions: any;
    let unindexedData: any;
    let randomProof: any;
    let randomProof2: any;
    let transferId: any;

    const chainIds = [31337, 31337]; // hardhat network chainId is 31337
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();

        minGas = ethers.utils.parseEther("0.001");

        const ProverMock = await ethers.getContractFactory("CrossL2ProverV2Mock");
        proverMock = await ProverMock.deploy();

        const BridgeAdapter = await ethers.getContractFactory("PolymerAdapter");
        adapter = await BridgeAdapter.deploy(proverMock.address, "Polymer Adapter", minGas, treasurySigner.address, chainIds, ownerSigner.address);

        // Set the trusted adapter - in theory the adapter in the other chain, but for testing purposes we set the same adapter
        await adapter.setTrustedAdapter(chainIds[1], adapter.address);
        await adapter.setTrustedAdapter(chainIds[0], adapter.address);

        // abi encode refund address
        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
    });
    describe("constructor", () => {
        it("should set the adapterName", async () => {
            expect(await adapter.adapterName()).to.be.equal("Polymer Adapter");
        });
        it("should set the minGas", async () => {
            expect(await adapter.minGas()).to.be.equal(ethers.utils.parseEther("0.001"));
        });
        it("should set the treasury", async () => {
            expect(await adapter.protocolFeeRecipient()).to.be.equal(treasurySigner.address);
        });
        it("should set the owner", async () => {
            const defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
            expect(await adapter.hasRole(defaultAdminRole, ownerSigner.address)).to.be.true;
        });
        it("should set the chainIds", async () => {
            expect(await adapter.supportedChainIds(chainIds[0])).to.be.equal(true);
            expect(await adapter.supportedChainIds(chainIds[1])).to.be.equal(true);
        });
    });
    describe("relayMessage", () => {
        beforeEach(async () => {
            // Deploy Source MessageControllerUpgradeable contract
            const Controller = await ethers.getContractFactory("MessageControllerUpgradeable");
            sourceController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [adapter.address],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {
                    initializer: "initialize",
                }
            );
            await sourceController.deployed();

            destController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [adapter.address],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {
                    initializer: "initialize",
                }
            );
            await destController.deployed();

            // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
            await sourceController.setControllerForChain([chainIds[0]], [destController.address]);
            await destController.setControllerForChain([chainIds[1]], [sourceController.address]);
        });
        it("should collect and redirect the protocol fee", async () => {
            const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    31337,
                    [adapter.address],
                    [minGas],
                    [bridgeOptions],
                    {
                        value: minGas,
                    }
                );
            const treasureBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
            expect(treasureBalanceAfter.sub(treasuryBalanceBefore)).to.be.equal(minGas);
        });
        it("should collect and refund the protocol fee if they are paid in excess", async () => {
            const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
            const userBalanceBefore = await ethers.provider.getBalance(user1Signer.address);
            const value = minGas.mul(2);
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    31337,
                    [adapter.address],
                    [value],
                    [bridgeOptions],
                    {
                        value: value,
                    }
                );
            const txReceipt = await tx.wait();
            const gasUsed = txReceipt.cumulativeGasUsed.mul(txReceipt.effectiveGasPrice);

            const treasureBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
            const userBalanceAfter = await ethers.provider.getBalance(user1Signer.address);

            expect(treasureBalanceAfter.sub(treasuryBalanceBefore)).to.be.equal(minGas);
            expect(userBalanceBefore.sub(userBalanceAfter)).to.be.equal(minGas.add(gasUsed));
        });
        it("should revert if there is no trusted adapter set", async () => {
            await adapter.setTrustedAdapter(chainIds[1], ethers.constants.AddressZero);
            await expect(
                sourceController
                    .connect(user1Signer)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                        31337,
                        [adapter.address],
                        [minGas],
                        [bridgeOptions],
                        {
                            value: minGas,
                        }
                    )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
            await adapter.setTrustedAdapter(chainIds[1], adapter.address);
        });
        it("should revert if the destination chain is not supported", async () => {
            await expect(
                sourceController
                    .connect(user1Signer)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                        300,
                        [adapter.address],
                        [minGas],
                        [bridgeOptions],
                        {
                            value: minGas,
                        }
                    )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should emit a RelayViaPolymer event", async () => {
            const transferId = await adapter.calculateTransferId(31337);

            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    31337,
                    [adapter.address],
                    [minGas],
                    [bridgeOptions],
                    {
                        value: minGas,
                    }
                );
            await expect(tx).to.emit(adapter, "RelayViaPolymer").withArgs(31337, adapter.address, transferId, anyValue);
        });
        it("should increase the nonce", async () => {
            const nonceBefore = await adapter.nonce();
            await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [0x0], ethers.constants.HashZero, 1],
                    31337,
                    [adapter.address],
                    [minGas],
                    [bridgeOptions],
                    {
                        value: minGas,
                    }
                );
            const nonceAfter = await adapter.nonce();
            expect(nonceAfter.sub(nonceBefore)).to.be.equal(1);
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

            // Deploy Source MessageControllerUpgradeable contract
            const Controller = await ethers.getContractFactory("MessageControllerUpgradeable");
            sourceController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [adapter.address],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {
                    initializer: "initialize",
                }
            );
            await sourceController.deployed();

            destController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [adapter.address],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {
                    initializer: "initialize",
                }
            );
            await destController.deployed();

            // Call setControllerForChain on Source and Dest Controller to register other Controller contracts
            await sourceController.setControllerForChain([chainIds[1]], [destController.address]);
            await destController.setControllerForChain([chainIds[0]], [sourceController.address]);

            // Send a message to destController
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage([[counter.address], [calldata], ethers.constants.HashZero, 1], 31337, [adapter.address], [minGas], [bridgeOptions], {
                    value: minGas,
                });
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;

            // Generate a random byte array (32 bytes)
            const randomBytes = ethers.utils.randomBytes(32);
            // ABI encode the bytes
            randomProof = ethers.utils.defaultAbiCoder.encode(["bytes"], [randomBytes]);
            randomProof2 = ethers.utils.defaultAbiCoder.encode(["bytes"], [ethers.utils.randomBytes(32)]);
            transferId = await adapter.calculateTransferId(31337);

            // Get the unindexed data from the RelayViaPolymer event by decoding the raw log
            const adapterInterface = adapter.interface;
            const relayEventTopic = adapterInterface.getEventTopic("RelayViaPolymer");
            const relayLog = receipt.logs.find(
                (log: any) => log.address.toLowerCase() === adapter.address.toLowerCase() && log.topics[0] === relayEventTopic
            );
            const parsedRelay = adapterInterface.parseLog(relayLog);
            unindexedData = parsedRelay.args.message;

            // Set bridged message to CrossL2ProverV2Mock
            const eventHash = await adapter.RELAY_EVENT_HASH();
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [eventHash, 31337, adapter.address, transferId]
            );
            await proverMock.setEvent(randomProof, 31337, adapter.address, indexedData, unindexedData);
            await proverMock.setEvent(randomProof2, 31337, adapter.address, indexedData, unindexedData); // same data under different proof
        });
        it("should register the Message", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
            await adapter.receiveMessage(randomProof);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });
        it("should revert if the proof is invalid", async () => {
            // Generate a random byte array (32 bytes)
            const randomBytes = ethers.utils.randomBytes(32);
            // ABI encode the bytes
            randomProof = ethers.utils.defaultAbiCoder.encode(["bytes"], [randomBytes]);
            await expect(adapter.receiveMessage(randomProof)).to.be.reverted;
        });
        it("should accept packed RelayViaPolymer topics with length 128", async () => {
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[counter.address], [counter.interface.encodeFunctionData("increment", [])], ethers.constants.HashZero, 1],
                    31337,
                    [adapter.address],
                    [minGas],
                    [bridgeOptions],
                    {
                        value: minGas,
                    }
                );
            const receipt = await tx.wait();
            const adapterInterface = adapter.interface;
            const relayEventTopic = adapterInterface.getEventTopic("RelayViaPolymer");
            const relayLog = receipt.logs.find(
                (log: any) => log.address.toLowerCase() === adapter.address.toLowerCase() && log.topics[0] === relayEventTopic
            );

            const packedTopics = ethers.utils.solidityPack(["bytes32", "bytes32", "bytes32", "bytes32"], relayLog.topics);
            expect(ethers.utils.arrayify(packedTopics).length).to.equal(128);

            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            const messageIdFromEvent = msgCreatedEvent?.args?.messageId;
            const parsedRelay = adapterInterface.parseLog(relayLog);
            const rawMessage = parsedRelay.args.message;

            const proofFromEventTopics = ethers.utils.defaultAbiCoder.encode(["bytes"], [ethers.utils.randomBytes(32)]);
            await proverMock.setEvent(proofFromEventTopics, 31337, adapter.address, packedTopics, rawMessage);

            expect(await destController.isReceivedMessageExecutable(messageIdFromEvent)).to.be.equal(false);

            await adapter.receiveMessage(proofFromEventTopics);
            expect(await destController.isReceivedMessageExecutable(messageIdFromEvent)).to.be.equal(true);
        });
        it("should revert if topics length is less than 128", async () => {
            const eventHash = await adapter.RELAY_EVENT_HASH();
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [eventHash, 31337, adapter.address, transferId]
            );
            const shortTopics = ethers.utils.hexDataSlice(indexedData, 0, 127);

            await proverMock.setEvent(randomProof, 31337, adapter.address, shortTopics, unindexedData);
            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_InvalidProof");
        });
        it("should revert if topics length is greater than 128", async () => {
            const eventHash = await adapter.RELAY_EVENT_HASH();
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [eventHash, 31337, adapter.address, transferId]
            );
            const longTopics = ethers.utils.hexConcat([indexedData, "0x00"]);

            await proverMock.setEvent(randomProof, 31337, adapter.address, longTopics, unindexedData);
            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_InvalidProof");
        });
        it("should revert if the destination address is not the same as the adapter", async () => {
            // Set faulty bridged message to CrossL2ProverV2Mock
            const eventHash = await adapter.RELAY_EVENT_HASH();
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [eventHash, 31337, ownerSigner.address, transferId]
            );
            await proverMock.setEvent(randomProof, 31337, adapter.address, indexedData, unindexedData);

            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_InvalidProof");
        });
        it("should revert if the hash is not the same as the event hash", async () => {
            // Set faulty bridged message to CrossL2ProverV2Mock
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [ethers.constants.HashZero, 31337, adapter.address, transferId]
            );
            await proverMock.setEvent(randomProof, 31337, adapter.address, indexedData, unindexedData);

            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_InvalidProof");
        });
        it("should revert if the origin adapter is not set", async () => {
            await adapter.setTrustedAdapter(chainIds[0], ethers.constants.AddressZero);
            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_InvalidProof");
        });
        it("should revert if the transferId has already been processed, even if the proof is different", async () => {
            await adapter.receiveMessage(randomProof);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
            await expect(adapter.receiveMessage(randomProof2)).to.be.revertedWithCustomError(adapter, "Adapter_AlreadyProcessed");
        });
        it("should revert if the originSender from Prover is not the sourceAdapter", async () => {
            // Set faulty bridged message to CrossL2ProverV2Mock
            const eventHash = await adapter.RELAY_EVENT_HASH();
            const indexedData = ethers.utils.defaultAbiCoder.encode(
                ["bytes32", "uint256", "address", "bytes32"],
                [eventHash, 31337, adapter.address, transferId]
            );
            await proverMock.setEvent(randomProof, 31337, ownerSigner.address, indexedData, unindexedData);
            await expect(adapter.receiveMessage(randomProof)).to.be.revertedWithCustomError(adapter, "Adapter_Unauthorised");
        });
    });
    describe("setDomainId", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setDomainId([1], true)).to.be.reverted;
        });
        it("should set the domainId", async () => {
            await adapter.setDomainId([1], true);
            expect(await adapter.supportedChainIds(1)).to.be.equal(true);
        });
        it("should emit a ChainIdSet event", async () => {
            await expect(adapter.setDomainId([1], true))
                .to.emit(adapter, "ChainIdSet")
                .withArgs(1, true);
        });
    });
    describe("setTrustedAdapter", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setTrustedAdapter(1, user1Signer.address)).to.be.reverted;
        });
        it("should set the trusted adapter", async () => {
            await adapter.setTrustedAdapter(1, user1Signer.address);
            expect(await adapter.trustedAdapters(1)).to.be.equal(user1Signer.address);
        });
        it("should emit a TrustedAdapterSet event", async () => {
            await expect(adapter.setTrustedAdapter(1, user1Signer.address)).to.emit(adapter, "TrustedAdapterSet").withArgs(user1Signer.address, 1);
        });
    });
    describe("setMinGas", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setMinGas(ethers.utils.parseEther("0.002"))).to.be.reverted;
        });
        it("should set the minGas", async () => {
            await adapter.setMinGas(ethers.utils.parseEther("0.002"));
            expect(await adapter.minGas()).to.be.equal(ethers.utils.parseEther("0.002"));
        });
        it("should emit a MinGasSet event", async () => {
            await expect(adapter.setMinGas(ethers.utils.parseEther("0.002")))
                .to.emit(adapter, "MinGasSet")
                .withArgs(ethers.utils.parseEther("0.002"));
        });
    });
    describe("setProtocolFee", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setProtocolFee(2500, treasurySigner.address)).to.be.reverted;
        });
        it("should set the protocol fee", async () => {
            await adapter.setProtocolFee(2500, ownerSigner.address);
            expect(await adapter.protocolFeeRecipient()).to.be.equal(ownerSigner.address);
            expect(await adapter.protocolFee()).to.be.equal(2500);
        });
        it("should emit a ProtocolFeeSet event", async () => {
            await expect(adapter.setProtocolFee(3000, treasurySigner.address)).to.emit(adapter, "ProtocolFeeSet").withArgs(3000);
        });
        it("should revert if fee > FEE_DECIMALS", async () => {
            const feeDecimals = await adapter.FEE_DECIMALS();
            await expect(adapter.connect(ownerSigner).setProtocolFee(feeDecimals + 1, treasurySigner.address)).to.be.revertedWithCustomError(
                adapter,
                "Adapter_InvalidParams"
            );
        });
        it("should revert if treasury is the zero address", async () => {
            await expect(adapter.connect(ownerSigner).setProtocolFee(1000, ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                adapter,
                "Adapter_InvalidParams"
            );
        });
    });
    describe("pause", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).pause()).to.be.reverted;
        });
        it("should pause the contract", async () => {
            await adapter.connect(ownerSigner).pause();
            expect(await adapter.paused()).to.be.equal(true);
            await adapter.unpause();
        });
        it("should emit a Paused event", async () => {
            await expect(adapter.connect(ownerSigner).pause()).to.emit(adapter, "Paused");
            await adapter.unpause();
        });
    });
    describe("unpause", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).unpause()).to.be.reverted;
        });
        it("should unpause the contract", async () => {
            await adapter.connect(ownerSigner).pause();
            expect(await adapter.paused()).to.be.equal(true);
            await adapter.connect(ownerSigner).unpause();
            expect(await adapter.paused()).to.be.equal(false);
        });
        it("should emit an Unpaused event", async () => {
            await adapter.connect(ownerSigner).pause();
            await expect(adapter.connect(ownerSigner).unpause()).to.emit(adapter, "Unpaused");
        });
    });
    describe("grantRole", () => {
        it("should revert if non admin attempts to set DEFAULT_ADMIN_ROLE", async () => {
            const defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
            await expect(adapter.connect(user1Signer).grantRole(defaultAdminRole, user1Signer.address)).to.be.reverted;
        });
        it("should set DEFAULT_ADMIN_ROLE", async () => {
            const defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();

            await adapter.connect(ownerSigner).grantRole(defaultAdminRole, user1Signer.address);
            expect(await adapter.hasRole(defaultAdminRole, user1Signer.address)).to.be.true;
        });
    });
});
