import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("LayerZero Adapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let Adapter: any;
    let adapter: Contract;

    let sourceAdapter: Contract;
    let destAdapter: Contract;
    let sourceMockEndpoint: Contract; // mock endpoint for source chain
    let destMockEndpoint: Contract; // mock endpoint for destination chain

    let destController: Contract;
    let sourceController: Contract;

    let message: any;
    let bridgeOptions: any;
    let defaultAdminRole: any;
    let pauseRole: any;

    // Specify a high relayer fee for LayerZero
    const relayerFee = ethers.utils.parseEther("0.008");

    // source & destination chain
    const chainIds = [100, 200];
    const domainIds = [1001, 2001];
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();
        const LayerZeroBridge = await ethers.getContractFactory("EndpointV2Mock");
        sourceMockEndpoint = await LayerZeroBridge.deploy(domainIds[0]);
        destMockEndpoint = await LayerZeroBridge.deploy(domainIds[1]);

        Adapter = await ethers.getContractFactory("LayerZeroAdapter");
    });

    describe("constructor", () => {
        it("should set the endpoint", async () => {
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.endpoint()).to.equal(sourceMockEndpoint.address);
        });
        it("should revert if the endpoint is zero address", async () => {
            await expect(
                Adapter.deploy(
                    ethers.constants.AddressZero,
                    "LayerZero Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.reverted;
        });

        it("should revert if domainIds and chainIds length mismatch", async () => {
            await expect(
                Adapter.deploy(
                    sourceMockEndpoint.address,
                    "LayerZero Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    [100],
                    [1001, 2001],
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });

        it("should set domainIdChains and chainIdDomains", async () => {
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            for (let i = 0; i < chainIds.length; i++) {
                expect(await adapter.domainIdChains(domainIds[i])).to.equal(chainIds[i]);
                expect(await adapter.chainIdDomains(chainIds[i])).to.equal(domainIds[i]);
            }
        });
        it("should revert if protocol fee > FEE_DECIMALS", async () => {
            await expect(adapter.connect(ownerSigner).setProtocolFee(100001, treasurySigner.address)).to.be.revertedWithCustomError(
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

    describe("relayMessage", () => {
        beforeEach(async () => {
            sourceAdapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[1]],
                [domainIds[1]],
                ownerSigner.address
            );
            destAdapter = await Adapter.deploy(
                destMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[0]],
                [domainIds[0]],
                ownerSigner.address
            );

            // MOCK Setting destination endpoints in the LZEndpoint mock for each OApp instance
            await sourceMockEndpoint.setDestLzEndpoint(destAdapter.address, destMockEndpoint.address);
            await destMockEndpoint.setDestLzEndpoint(sourceAdapter.address, sourceMockEndpoint.address);

            // After bridge addapters' address is known, set it in the other adapter contract
            await sourceAdapter.setTrustedAdapter(chainIds[1], destAdapter.address);
            await destAdapter.setTrustedAdapter(chainIds[0], sourceAdapter.address);

            // Specific to LayerZero: SetPeer - Use zeroPad from ethers to convert address to bytes32
            await sourceAdapter.setPeer(domainIds[1], ethers.utils.zeroPad(destAdapter.address, 32));
            await destAdapter.setPeer(domainIds[0], ethers.utils.zeroPad(sourceAdapter.address, 32));

            // abi encode options
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 500000]);
        });

        it("should revert if there's no domain id for the destination chain", async () => {
            await expect(
                sourceAdapter.relayMessage(999, user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {
                    value: 1000,
                })
            ).to.be.revertedWithCustomError(sourceAdapter, "Adapter_InvalidParams");
        });

        it("should revert if trusted adapter is not set", async () => {
            // Remove trusted adapter for chainIds[1]
            await sourceAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.constants.AddressZero);
            await expect(
                sourceAdapter.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {
                    value: 0,
                })
            ).to.be.revertedWithCustomError(sourceAdapter, "Adapter_InvalidParams");
        });

        it("should revert if contract is paused", async () => {
            await sourceAdapter.connect(ownerSigner).pause();
            await expect(
                sourceAdapter.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {
                    value: 0,
                })
            ).to.be.revertedWith("Pausable: paused");
        });

        describe("message sending", () => {
            beforeEach(async () => {
                message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            });

            it("should call _lzSend on the endpoint and return a transferId", async () => {
                // The transferId is returned as the return value
                // We can call static to get the return value
                const transferId = await sourceAdapter
                    .connect(user1Signer)
                    .callStatic.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee});
                expect(transferId).to.be.a("string");
                expect(transferId.length).to.equal(66); // 0x + 64 hex chars
            });

            it("should collect protocol fee and send to treasury", async () => {
                // relayerFee is set already in excess
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                await sourceAdapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee});
                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                // Protocol fee should be collected (1% of nativeFee)
                expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
            });

            it("should not collect a fee if protocol fee is set to 0", async () => {
                // Set protocol fee to 0
                await sourceAdapter.connect(ownerSigner).setProtocolFee(0, treasurySigner.address);
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                await sourceAdapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee});
                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                // No fee should be collected
                expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
            });

            it("should revert if sent value is less than required fee + protocol fee", async () => {
                // Get a quote:
                const quote = await sourceAdapter.quoteMessage(user1Signer.address, chainIds[1], 500000, message, true);
                const pFee = await sourceAdapter.calculateFee(quote);
                // Send less than required
                await expect(
                    sourceAdapter.connect(ownerSigner).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: quote.sub(1)})
                ).to.be.revertedWithCustomError(sourceAdapter, "Adapter_FeeTooLow");
            });

            it("should revert if sent value is less than minGas", async () => {
                // Set minGas to a high value
                await sourceAdapter.connect(ownerSigner).setMinGas(ethers.utils.parseEther("1"));
                await expect(
                    sourceAdapter.connect(user1Signer).relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: relayerFee})
                ).to.be.revertedWithCustomError(sourceAdapter, "Adapter_ValueIsLessThanLimit");
            });
        });
    });

    describe("message receiving", () => {
        beforeEach(async () => {
            // Source - chain id chainIds[0]
            // Destination - chain id chainIds[1]

            sourceAdapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[1]],
                [domainIds[1]],
                ownerSigner.address
            );
            destAdapter = await Adapter.deploy(
                destMockEndpoint.address,
                "LayerZero Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[0]],
                [domainIds[0]],
                ownerSigner.address
            );

            // MOCK Setting destination endpoints in the LZEndpoint mock for each OApp instance
            await sourceMockEndpoint.setDestLzEndpoint(destAdapter.address, destMockEndpoint.address);
            await destMockEndpoint.setDestLzEndpoint(sourceAdapter.address, sourceMockEndpoint.address);

            // After bridge addapters' address is known, set it in the other adapter contract
            await sourceAdapter.setTrustedAdapter(chainIds[1], destAdapter.address);
            await destAdapter.setTrustedAdapter(chainIds[0], sourceAdapter.address);

            // Specific to LayerZero: SetPeer - Use zeroPad from ethers to convert address to bytes32
            await sourceAdapter.setPeer(domainIds[1], ethers.utils.zeroPad(destAdapter.address, 32));
            await destAdapter.setPeer(domainIds[0], ethers.utils.zeroPad(sourceAdapter.address, 32));

            // abi encode options
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 500000]);

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

            // Set controller for chain on both controllers
            await sourceController.setControllerForChain([chainIds[1]], [destController.address]);
            await destController.setControllerForChain([chainIds[0]], [sourceController.address]);

            // Set adapter on controllers
            await destController.connect(ownerSigner).setLocalAdapter([destAdapter.address], [true]);
            await sourceController.connect(ownerSigner).setLocalAdapter([sourceAdapter.address], [true]);
        });

        it("should mark a message as executable when a valid message is received", async () => {
            // Send a message to destController
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const randomAddress = ethers.Wallet.createRandom().address;
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[randomAddress], [message], ethers.constants.HashZero, 1],
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
            const messageId = msgCreatedEvent?.args?.messageId;
            // The Endpoint V2 mock forwards the message automatically to the destination adapter
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });

        it("should revert if the Peer is not associated with the source adapter", async () => {
            // Remove Peer for domainIds[0]
            await destAdapter.connect(ownerSigner).setPeer(domainIds[0], ethers.constants.HashZero);
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [message], ethers.constants.HashZero, 1],
                    chainIds[1],
                    [sourceAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            const messageId = msgCreatedEvent?.args?.messageId;
            // LayerZero Mock Endpoint V2 automatically forwards the message to the destination adapter, but it silently reverts
            // Check that the message is not executable
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
        });

        it("should revert if the origin sender is not trusted", async () => {
            // Remove trusted adapter for chainIds[0]
            await destAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], ethers.constants.AddressZero);
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[ethers.constants.AddressZero], [message], ethers.constants.HashZero, 1],
                    chainIds[1],
                    [sourceAdapter.address],
                    [relayerFee],
                    [bridgeOptions],
                    {value: relayerFee}
                );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            const messageId = msgCreatedEvent?.args?.messageId;
            // LayerZero Mock Endpoint V2 automatically forwards the message to the destination adapter, but it silently reverts
            // Check that the message is not executable
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(false);
        });
        // Note: LZ Endpoint prevents double-processing at the contract level, transferIds generated are unique and txs cannot be replayed
    });

    describe("quoteMessage", () => {
        beforeEach(async () => {
            message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        });
        it("should return fee including protocol fee when includeFee=true", async () => {
            const feeWithProtocol = await sourceAdapter.quoteMessage(user1Signer.address, chainIds[1], 500000, message, true);
            const feeWithoutProtocol = await sourceAdapter.quoteMessage(user1Signer.address, chainIds[1], 500000, message, false);
            expect(feeWithProtocol).to.be.gt(feeWithoutProtocol);
            const expectedProtocolFee = await sourceAdapter.calculateFee(feeWithoutProtocol);
            expect(feeWithProtocol).to.equal(feeWithoutProtocol.add(expectedProtocolFee));
        });
    });

    describe("setDomainId", () => {
        beforeEach(async () => {
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
            adapter = await Adapter.deploy(
                sourceMockEndpoint.address,
                "LayerZero Adapter",
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
