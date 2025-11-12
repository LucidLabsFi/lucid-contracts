import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("OptimismL2Adapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let adapter: Contract;
    let messengerMock: Contract;
    let counter: Contract;
    let destController: Contract;
    let sourceController: Contract;
    let minGas: BigNumber;
    let messageId: any;
    let bridgeOptions: any;

    const chainIds = [100, 200];
    const chainIdsInverted = [200, 100];
    before(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();

        minGas = ethers.utils.parseEther("0.001");

        const MessengerMock = await ethers.getContractFactory("L2ToL2CrossDomainMessengerMock");
        messengerMock = await MessengerMock.deploy(chainIds, chainIdsInverted);
        // console.log("MessengerMock deployed to:", messengerMock.address);

        const BridgeAdapter = await ethers.getContractFactory("OptimismL2AdapterMock");
        adapter = await BridgeAdapter.deploy("Optimism L2 Adapter", minGas, treasurySigner.address, chainIds, ownerSigner.address);

        // Set the trusted adapter - in theory the adapter in the other chain, but for testing purposes we set the same adapter
        await adapter.setTrustedAdapter(chainIds[1], adapter.address);
        await adapter.setTrustedAdapter(chainIds[0], adapter.address);

        // abi encode refund address
        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
    });
    describe("constructor", () => {
        it("should set the adapterName", async () => {
            expect(await adapter.adapterName()).to.be.equal("Optimism L2 Adapter");
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
                    200,
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
                    200,
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
                        200,
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
                .sendMessage([[counter.address], [calldata], ethers.constants.HashZero, 1], 200, [adapter.address], [minGas], [bridgeOptions], {
                    value: minGas,
                });
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should register the Message", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
            const currentNonce = await messengerMock.nonce();
            await messengerMock.processMessageAndSetCDM(currentNonce);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });
        it("should revert if the caller is not the bridge adapter", async () => {
            await expect(adapter.receiveMessage([0x0])).to.be.revertedWithCustomError(adapter, "Adapter_Unauthorised");
        });
        it("should revert if the caller is not the cross domain message source or chain is not set", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);

            // Change previous state:
            await messengerMock._setCrossDomainMessageSender(ethers.constants.AddressZero);
            await messengerMock._setCrossDomainMessageSource(0);

            const currentNonce = await messengerMock.nonce();
            await expect(messengerMock.processMessage(currentNonce)).to.be.revertedWith("Message processing failed");
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
