import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, BigNumber} from "ethers";

describe("WormholeAdapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let adapter: Contract;
    let WormholeAdapter: any;
    let wormholeMock: Contract;
    let relayerFee: BigNumber;

    let destController: Contract;
    let sourceController: Contract;

    let sourceAdapter: Contract;
    let destAdapter: Contract;

    let messageId: any;
    let message: any;
    let bridgeOptions: any;
    let defaultAdminRole: any;
    let pauseRole: any;

    const chainIds = [100, 200];
    const domainIds = [1001, 1002];
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();

        const WormholeMock = await ethers.getContractFactory("WormholeMock");
        wormholeMock = await WormholeMock.deploy();

        WormholeAdapter = await ethers.getContractFactory("WormholeAdapter");

        // abi encode refund, gasLimit and refund chain address
        relayerFee = ethers.utils.parseEther("0.01");
        bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256", "uint256"], [user1Signer.address, chainIds[1], 500000]);
    });

    describe("constructor", () => {
        beforeEach(async () => {});
        it("should set the wormhole router", async () => {
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.BRIDGE()).to.equal(wormholeMock.address);
        });
        it("should revert if BRIDGE is zero address", async () => {
            await expect(
                WormholeAdapter.deploy(
                    ethers.constants.AddressZero,
                    "Wormhole Adapter",
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
                WormholeAdapter.deploy(wormholeMock.address, "Wormhole Adapter", 100, treasurySigner.address, 1000, [1, 2], [1], ownerSigner.address)
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });
        it("should set domainIdChains and chainIdDomains", async () => {
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.domainIdChains(1001)).to.equal(chainIds[0]);
            expect(await adapter.domainIdChains(1002)).to.equal(chainIds[1]);
            expect(await adapter.chainIdDomains(chainIds[0])).to.equal(1001);
            expect(await adapter.chainIdDomains(chainIds[1])).to.equal(1002);
        });
        it("should revert if protocol fee > FEE_DECIMALS", async () => {
            await expect(
                WormholeAdapter.deploy(
                    wormholeMock.address,
                    "Wormhole Adapter",
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
                WormholeAdapter.deploy(
                    wormholeMock.address,
                    "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            // Set trusted adapter for dest chain
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.Wallet.createRandom().address);
            message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
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
        it("should revert if refundDomainId is 0", async () => {
            const options = ethers.utils.defaultAbiCoder.encode(["address", "uint256", "uint256"], [user1Signer.address, 0, 500000]);

            await expect(
                adapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, options, message, {value: relayerFee})
            ).to.be.revertedWithCustomError(adapter, "Adapter_UnknownRefundChainId");
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
                // Set origin domain id for this adapter in WormholeMock
                await wormholeMock.setOriginDomainId(adapter.address, domainIds[0]);
            });
            it("should call sendPayloadToEvm and callContract on WormholeMock", async () => {
                const tx = await adapter
                    .connect(user1Signer)
                    .relayMessage(chainIds[1], ethers.Wallet.createRandom().address, bridgeOptions, message, {value: relayerFee});
                // Should increment counter in WormholeMock
                expect(await wormholeMock.counter()).to.equal(1);
                const req = await wormholeMock.requests(1);
                expect(req.originSender).to.equal(adapter.address);
                expect(req.originDomainId).to.equal(domainIds[0]);
                expect(req.destination).to.equal(domainIds[1]);
            });
            it("should collect protocol fee and send to treasury", async () => {
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                await adapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee});
                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
            });
            it("should not collect a fee if protocol fee is set to 0", async () => {
                await adapter.connect(ownerSigner).setProtocolFee(0, treasurySigner.address);
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                await adapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee});
                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
            });
            it("should revert if sent value is less than required fee + protocol fee", async () => {
                const quote = await adapter.quoteMessage(chainIds[1], 500000, true);
                await expect(
                    adapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: quote.sub(1)})
                ).to.be.revertedWithCustomError(adapter, "Adapter_FeeTooLow");
            });
            it("should revert if sent value is less than minGas", async () => {
                await adapter.connect(ownerSigner).setMinGas(ethers.utils.parseEther("1"));
                await expect(
                    adapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee})
                ).to.be.revertedWithCustomError(adapter, "Adapter_ValueIsLessThanLimit");
            });
            it("should refund excess value to refundAddress", async () => {
                // Use a random address for refund to avoid gas cost confusion
                const refundWallet = ethers.Wallet.createRandom();

                const options = ethers.utils.defaultAbiCoder.encode(["address", "uint256", "uint256"], [refundWallet.address, chainIds[1], 500000]);
                const balanceBefore = await ethers.provider.getBalance(refundWallet.address);
                const quote = await adapter.quoteMessage(chainIds[1], 500000, true);
                const excess = ethers.utils.parseEther("1");
                await adapter.connect(ownerSigner).relayMessage(chainIds[1], user1Signer.address, options, message, {value: quote.add(excess)});
                const balanceAfter = await ethers.provider.getBalance(refundWallet.address);
                expect(balanceAfter.sub(balanceBefore)).to.equal(excess);
            });
        });
    });

    describe("message receiving", () => {
        beforeEach(async () => {
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
            sourceAdapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                100,
                chainIds,
                domainIds,
                ownerSigner.address
            );

            destAdapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                100,
                chainIds,
                domainIds,
                ownerSigner.address
            );

            // Set trusted adapter
            await sourceAdapter.setTrustedAdapter(chainIds[1], destAdapter.address);
            await destAdapter.setTrustedAdapter(chainIds[0], sourceAdapter.address);

            // Set controller for chain on both controllers
            await sourceController.setControllerForChain([chainIds[1]], [destController.address]);
            await destController.setControllerForChain([chainIds[0]], [sourceController.address]);

            await wormholeMock.setOriginDomainId(sourceAdapter.address, domainIds[0]);
            await wormholeMock.setOriginDomainId(destAdapter.address, domainIds[1]);

            // Set adapter on controllers
            await destController.connect(ownerSigner).setLocalAdapter([destAdapter.address], [true]);
            await sourceController.connect(ownerSigner).setLocalAdapter([sourceAdapter.address], [true]);

            // Send a message to destController
            // Create a random message (since it won't be executed)
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [message], ethers.constants.HashZero, 1],
                    chainIds[1],
                    [sourceAdapter.address],
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
        it("should mark a message as executable when a valid message is received", async () => {
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
            // Now call handle to trigger execute
            await wormholeMock.callHandle(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });

        it("should revert if the origin sender is not trusted", async () => {
            await destAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], ethers.constants.AddressZero);
            // Now call handle to trigger execute
            await expect(wormholeMock.callHandle(1)).to.be.revertedWithCustomError(adapter, "Adapter_Unauthorised");
        });

        it("should revert if the transferId is already processed", async () => {
            await wormholeMock.callHandle(1);
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
            // Try to process again
            await expect(wormholeMock.callHandle(1)).to.be.revertedWithCustomError(adapter, "Adapter_AlreadyProcessed");
        });

        it("should revert if msg.sender is not the Gateway", async () => {
            const payload = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const additionalMessages: any[] = [];
            const sourceAddress = ethers.utils.hexZeroPad(user1Signer.address, 32);
            const sourceChain = domainIds[0];
            const deliveryHash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            await expect(
                destAdapter.connect(user1Signer).receiveWormholeMessages(payload, additionalMessages, sourceAddress, sourceChain, deliveryHash)
            ).to.be.revertedWithCustomError(destAdapter, "Adapter_Unauthorised");
        });
    });

    describe("quoteMessage", () => {
        beforeEach(async () => {
            message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
        });
        it("should return fee including protocol fee when includeFee=true", async () => {
            const feeWithProtocol = await adapter.quoteMessage(chainIds[1], 500000, true);
            const feeWithoutProtocol = await adapter.quoteMessage(chainIds[1], 500000, false);
            expect(feeWithProtocol).to.be.gt(feeWithoutProtocol);
            const expectedProtocolFee = await adapter.calculateFee(feeWithoutProtocol);
            expect(feeWithProtocol).to.equal(feeWithoutProtocol.add(expectedProtocolFee));
        });
    });

    describe("setDomainId", () => {
        beforeEach(async () => {
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(adapter.connect(user1Signer).setDomainId([1001], [100])).to.be.revertedWith(/AccessControl/);
        });
        it("should revert if domainId and chainId length mismatch", async () => {
            await expect(adapter.connect(ownerSigner).setDomainId([1001, 2001], [100])).to.be.revertedWithCustomError(
                adapter,
                "Adapter_InvalidParams"
            );
        });
        it("should set the domainId and emit event", async () => {
            await expect(adapter.connect(ownerSigner).setDomainId([3001], [300]))
                .to.emit(adapter, "DomainIdAssociated")
                .withArgs(300, 3001);
            expect(await adapter.domainIdChains(3001)).to.equal(300);
            expect(await adapter.chainIdDomains(300)).to.equal(3001);
        });
    });

    describe("setTrustedAdapter", () => {
        beforeEach(async () => {
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
            adapter = await WormholeAdapter.deploy(
                wormholeMock.address,
                "Wormhole Adapter",
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
