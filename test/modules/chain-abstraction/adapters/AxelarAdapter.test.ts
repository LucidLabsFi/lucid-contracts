import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("AxelarAdapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let adapter: Contract;
    let AxelarAdapter: any;
    let axelarMock: Contract;

    let destController: Contract;
    let sourceController: Contract;

    let messageId: any;
    let message: any;
    let bridgeOptions: any;
    let defaultAdminRole: any;
    let pauseRole: any;

    const chainIds = [100, 200];
    const domainIds = ["Net1", "Net2"];
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();

        const AxelarMock = await ethers.getContractFactory("AxelarMock");
        axelarMock = await AxelarMock.deploy();

        // abi encode refund address
        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address"], [user1Signer.address]);
    });

    describe("constructor", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
        });
        it("should set the axelar gas service and the gateway", async () => {
            const randomAddress = ethers.Wallet.createRandom().address;
            adapter = await AxelarAdapter.deploy(
                randomAddress,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.gateway()).to.equal(randomAddress);
            expect(await adapter.axlGasService()).to.equal(axelarMock.address);
        });
        it("should revert if bridgeRouter is zero address", async () => {
            await expect(
                AxelarAdapter.deploy(
                    ethers.constants.AddressZero,
                    axelarMock.address,
                    "Axelar Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "InvalidAddress");
        });
        it("should revert if axelarGasService is zero address", async () => {
            await expect(
                AxelarAdapter.deploy(
                    axelarMock.address,
                    ethers.constants.AddressZero,
                    "Axelar Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should revert if domainIds and chainIds length mismatch", async () => {
            await expect(
                AxelarAdapter.deploy(
                    ethers.Wallet.createRandom().address,
                    axelarMock.address,
                    "Axelar Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    [1, 2],
                    ["Net1"],
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should set domainIdChains and chainIdDomains", async () => {
            adapter = await AxelarAdapter.deploy(
                ethers.Wallet.createRandom().address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.domainIdChains("Net1")).to.equal(chainIds[0]);
            expect(await adapter.domainIdChains("Net2")).to.equal(chainIds[1]);
            expect(await adapter.chainIdDomains(chainIds[0])).to.equal("Net1");
            expect(await adapter.chainIdDomains(chainIds[1])).to.equal("Net2");
        });
        it("should revert if protocol fee > FEE_DECIMALS", async () => {
            await expect(
                AxelarAdapter.deploy(
                    ethers.Wallet.createRandom().address,
                    axelarMock.address,
                    "Axelar Adapter",
                    100,
                    treasurySigner.address,
                    100001,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should revert if treasury is the zero address", async () => {
            await expect(
                AxelarAdapter.deploy(
                    ethers.Wallet.createRandom().address,
                    axelarMock.address,
                    "Axelar Adapter",
                    100,
                    ethers.constants.AddressZero,
                    1000,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
    });

    describe("relayMessage", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            // Set trusted adapter for dest chain
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.Wallet.createRandom().address);
        });
        it("should revert if there's no domain id for the destination chain", async () => {
            await expect(
                adapter
                    .connect(user1Signer)
                    .relayMessage(999, ethers.Wallet.createRandom().address, bridgeOptions, ethers.utils.hexlify(ethers.utils.randomBytes(32)), {
                        value: 1000,
                    })
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should revert if trusted adapter is not set", async () => {
            // Remove trusted adapter for chainIds[1]
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.constants.AddressZero);
            await expect(
                adapter
                    .connect(user1Signer)
                    .relayMessage(
                        chainIds[1],
                        ethers.Wallet.createRandom().address,
                        bridgeOptions,
                        ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                        {value: 1000}
                    )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should revert if contract is paused", async () => {
            await adapter.connect(ownerSigner).pause();
            await expect(
                adapter
                    .connect(user1Signer)
                    .relayMessage(
                        chainIds[1],
                        ethers.Wallet.createRandom().address,
                        bridgeOptions,
                        ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                        {value: 1000}
                    )
            ).to.be.revertedWith("Pausable: paused");
        });
        describe("message sending", () => {
            beforeEach(async () => {
                // Set trusted adapter for chainIds[1]
                const trustedAdapter = ethers.Wallet.createRandom().address;
                await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], trustedAdapter);
                // Set origin domain id for this adapter in AxelarMock
                await axelarMock.setOriginDomainId(adapter.address, "Net1");
                message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            });
            it("should call payNativeGasForContractCall and callContract on AxelarMock", async () => {
                const tx = await adapter
                    .connect(user1Signer)
                    .relayMessage(chainIds[1], ethers.Wallet.createRandom().address, bridgeOptions, message, {value: 1000});
                // Should increment counter in AxelarMock
                expect(await axelarMock.counter()).to.equal(1);
                const req = await axelarMock.requests(1);
                expect(req.originSender).to.equal(adapter.address);
                expect(req.destination).to.equal("Net2");
            });
            it("should collect and redirect the protocol fee", async () => {
                const protocolFee = await adapter.protocolFee(); // get procotol fee in bips
                const feeDecimals = await adapter.FEE_DECIMALS();
                const value = BigNumber.from(1000);
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                await adapter
                    .connect(user1Signer)
                    .relayMessage(chainIds[1], ethers.Wallet.createRandom().address, bridgeOptions, message, {value: value});
                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.equal(value.mul(protocolFee).div(feeDecimals) /* bips */);
            });
        });
    });

    describe("message receiving", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");

            // Deploy MessageControllerUpgradeable contracts
            const Controller = await ethers.getContractFactory("MessageControllerUpgradeable");
            sourceController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {initializer: "initialize"}
            );
            await sourceController.deployed();
            destController = await upgrades.deployProxy(
                Controller,
                [
                    [user1Signer.address],
                    ethers.constants.AddressZero,
                    [],
                    [],
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    0,
                    [ownerSigner.address, pauserSigner.address],
                ],
                {initializer: "initialize"}
            );
            await destController.deployed();
            // Deploy adapter after controllers so we can set trusted adapters
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                100,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            // Set trusted adapter
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], adapter.address);
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], adapter.address);

            // Set controller for chain on both controllers
            await sourceController.setControllerForChain([chainIds[1]], [destController.address]);
            await destController.setControllerForChain([chainIds[0]], [sourceController.address]);

            // Set adapter on controllers
            await destController.connect(ownerSigner).setLocalAdapter([adapter.address], [true]);
            await sourceController.connect(ownerSigner).setLocalAdapter([adapter.address], [true]);

            await axelarMock.setOriginDomainId(adapter.address, "Net1");
            // await axelarMock.setOriginDomainId(adapter.address, "Net2");

            // Send a message to destController
            // Create a random message (since it won't be executed)
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [message], ethers.constants.HashZero, 1],
                    chainIds[1],
                    [adapter.address],
                    [300],
                    [bridgeOptions],
                    {
                        value: 300,
                    }
                );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            messageId = msgCreatedEvent?.args?.messageId;
        });
        it("should mark a message as executable when a valid message is received", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
            // Now call handle to trigger execute
            await axelarMock.callHandle(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });

        it("should revert if the origin sender is not trusted", async () => {
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], ethers.constants.AddressZero);
            // Now call handle to trigger execute
            await expect(axelarMock.callHandle(1)).to.be.revertedWithCustomError(adapter, "Adapter_Unauthorised");
        });

        it("should revert if the transferId is already processed", async () => {
            await axelarMock.callHandle(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
            // Try to process again
            await expect(axelarMock.callHandle(1)).to.be.revertedWithCustomError(adapter, "Adapter_AlreadyProcessed");
        });

        it("should revert if msg.sender is not the Gateway", async () => {
            await axelarMock.setValidatingContractCalls(false);
            await expect(axelarMock.callHandle(1)).to.be.revertedWithCustomError(adapter, "NotApprovedByGateway");
        });
    });

    describe("setDomainId", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setDomainId(["Net3"], [300])).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
        it("should revert if domainId and chainId length mismatch", async () => {
            await expect(adapter.connect(ownerSigner).setDomainId(["Net3", "Net4"], [300])).to.be.revertedWithCustomError(
                adapter,
                "Adapter_InvalidParams"
            );
        });
        it("should set the domainId and emit event", async () => {
            const tx = await adapter.connect(ownerSigner).setDomainId(["Net3"], [300]);
            expect(await adapter.domainIdChains("Net3")).to.equal(300);
            expect(await adapter.chainIdDomains(300)).to.equal("Net3");
            await expect(tx).to.emit(adapter, "DomainIdAssociated").withArgs(300, "Net3");
        });
    });

    describe("setTrustedAdapter", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setTrustedAdapter(chainIds[0], ethers.Wallet.createRandom().address)).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
        it("should set the trusted adapter", async () => {
            const trustedAdapter = ethers.Wallet.createRandom().address;
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], trustedAdapter);
            expect(await adapter.trustedAdapters(chainIds[0])).to.equal(trustedAdapter);
        });
        it("should emit a TrustedAdapterSet event", async () => {
            const trustedAdapter = ethers.Wallet.createRandom().address;
            await expect(adapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], trustedAdapter))
                .to.emit(adapter, "TrustedAdapterSet")
                .withArgs(trustedAdapter, chainIds[0]);
        });
    });

    describe("setMinGas", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setMinGas(1234)).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
        it("should set the minGas", async () => {
            await adapter.connect(ownerSigner).setMinGas(1234);
            expect(await adapter.minGas()).to.equal(1234);
        });
        it("should emit a MinGasSet event", async () => {
            await expect(adapter.connect(ownerSigner).setMinGas(4321)).to.emit(adapter, "MinGasSet").withArgs(4321);
        });
    });

    describe("setProtocolFee", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setProtocolFee(1234, treasurySigner.address)).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
        it("should set the protocol fee", async () => {
            await adapter.connect(ownerSigner).setProtocolFee(1234, treasurySigner.address);
            expect(await adapter.protocolFee()).to.equal(1234);
        });
        it("should emit a ProtocolFeeSet event", async () => {
            await expect(adapter.connect(ownerSigner).setProtocolFee(4321, treasurySigner.address)).to.emit(adapter, "ProtocolFeeSet").withArgs(4321);
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
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            pauseRole = await adapter.PAUSE_ROLE();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).pause()).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${pauseRole}`
            );
        });
        it("should pause the contract", async () => {
            await adapter.connect(ownerSigner).pause();
            expect(await adapter.paused()).to.equal(true);
        });
        it("should emit a Paused event", async () => {
            await expect(adapter.connect(ownerSigner).pause()).to.emit(adapter, "Paused").withArgs(ownerSigner.address);
        });
    });

    describe("unpause", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            pauseRole = await adapter.PAUSE_ROLE();
            await adapter.connect(ownerSigner).pause();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).unpause()).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${pauseRole}`
            );
        });
        it("should unpause the contract", async () => {
            await adapter.connect(ownerSigner).unpause();
            expect(await adapter.paused()).to.equal(false);
        });
        it("should emit an Unpaused event", async () => {
            await expect(adapter.connect(ownerSigner).unpause()).to.emit(adapter, "Unpaused").withArgs(ownerSigner.address);
        });
    });

    describe("grantRole", () => {
        beforeEach(async () => {
            AxelarAdapter = await ethers.getContractFactory("AxelarAdapter");
            adapter = await AxelarAdapter.deploy(
                axelarMock.address,
                axelarMock.address,
                "Axelar Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            defaultAdminRole = await adapter.DEFAULT_ADMIN_ROLE();
        });
        it("should revert if non admin attempts to set DEFAULT_ADMIN_ROLE", async () => {
            await expect(adapter.connect(user1Signer).grantRole(defaultAdminRole, user1Signer.address)).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
        it("should set DEFAULT_ADMIN_ROLE", async () => {
            await adapter.connect(ownerSigner).grantRole(defaultAdminRole, user1Signer.address);
            expect(await adapter.hasRole(defaultAdminRole, user1Signer.address)).to.equal(true);
        });
    });
});
