import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("CCIP Adapter Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let Adapter: any;
    let adapter: Contract;
    let localSimulator: Contract;
    let ccipConfig: any;
    let quotedFee: any;
    let protocolFee: any;

    let sourceAdapter: Contract;
    let destAdapter: Contract;

    let destController: Contract;
    let sourceController: Contract;

    let message: any;
    let bridgeOptions: any;
    let defaultAdminRole: any;
    let pauseRole: any;

    const chainIds = [100, 200];
    const domainIds = [1001, 2001];
    beforeEach(async () => {
        [ownerSigner, user1Signer, treasurySigner, pauserSigner] = await ethers.getSigners();
        const localSimulatorFactory = await ethers.getContractFactory("CCIPLocalSimulator");
        localSimulator = await localSimulatorFactory.deploy();
        ccipConfig = await localSimulator.configuration();
        Adapter = await ethers.getContractFactory("CCIPAdapter");
    });

    describe("constructor", () => {
        it("should set the router", async () => {
            adapter = await Adapter.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                domainIds,
                ownerSigner.address
            );
            expect(await adapter.getRouter()).to.equal(ccipConfig.sourceRouter_);
        });
        it("should revert if bridgeRouter is zero address", async () => {
            await expect(
                Adapter.deploy(
                    ethers.constants.AddressZero,
                    "CCIP Adapter",
                    100,
                    treasurySigner.address,
                    1000,
                    chainIds,
                    domainIds,
                    ownerSigner.address
                )
            ).to.be.revertedWithCustomError(adapter, "InvalidRouter");
        });

        it("should revert if domainIds and chainIds length mismatch", async () => {
            await expect(
                Adapter.deploy(ccipConfig.sourceRouter_, "CCIP Adapter", 100, treasurySigner.address, 1000, [100], [1001, 2001], ownerSigner.address)
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });

        it("should set domainIdChains and chainIdDomains", async () => {
            adapter = await Adapter.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
            await expect(
                Adapter.deploy(
                    ccipConfig.sourceRouter_,
                    "CCIP Adapter",
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
                Adapter.deploy(
                    ccipConfig.sourceRouter_,
                    "CCIP Adapter",
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
            adapter = await Adapter.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
                100,
                treasurySigner.address,
                1000,
                chainIds,
                [ccipConfig.chainSelector_, ccipConfig.chainSelector_],
                ownerSigner.address
            );
            // Set trusted adapter for dest chain
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.Wallet.createRandom().address);
            // abi encode options
            bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 2000000]);
        });

        it("should revert if there's no domain id for the destination chain", async () => {
            await expect(
                adapter.relayMessage(999, user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {value: 0})
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });

        it("should revert if trusted adapter is not set", async () => {
            // Remove trusted adapter for chainIds[1]
            await adapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], ethers.constants.AddressZero);
            await expect(
                adapter.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {
                    value: 0,
                })
            ).to.be.revertedWithCustomError(adapter, "Adapter_InvalidParams");
        });

        it("should revert if contract is paused", async () => {
            await adapter.connect(ownerSigner).pause();
            await expect(
                adapter.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, ethers.utils.hexlify(ethers.utils.toUtf8Bytes("test")), {
                    value: 0,
                })
            ).to.be.revertedWith("Pausable: paused");
        });

        describe("message sending", () => {
            beforeEach(async () => {
                message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            });

            it("should call ccipSend on the router and return a transferId", async () => {
                // The router is the mock router from the simulator, which always returns keccak256(abi.encode(message))
                // The transferId is returned as the first event argument (if emitted), or as the return value
                // We can call static to get the return value
                const transferId = await adapter
                    .connect(user1Signer)
                    .callStatic.relayMessage(chainIds[1], user1Signer.address, bridgeOptions, message, {value: 2000});
                expect(transferId).to.be.a("string");
                expect(transferId.length).to.equal(66); // 0x + 64 hex chars
            });

            it("should not collect a protocol fee, but it should refund msg.value to refundAddress", async () => {
                // Mock router is set to always return a fee of 0, so no protocol fee should be collected
                const value = ethers.utils.parseEther("1");
                const treasuryBalanceBefore = await ethers.provider.getBalance(treasurySigner.address);
                const user1BalanceBefore = await ethers.provider.getBalance(user1Signer.address);

                await adapter.connect(ownerSigner).relayMessage(chainIds[1], ethers.Wallet.createRandom().address, bridgeOptions, message, {value});

                const treasuryBalanceAfter = await ethers.provider.getBalance(treasurySigner.address);
                expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.equal(0);
                // Expect refund to refund address (user1Signer)
                const user1BalanceAfter = await ethers.provider.getBalance(user1Signer.address);
                // user1BalanceAfter should be increased by value
                expect(user1BalanceAfter.sub(user1BalanceBefore)).to.equal(value);
            });
        });
    });

    describe("message receiving", () => {
        beforeEach(async () => {
            // Source - chain id chainIds[0]
            // Destination - chain id chainIds[1]

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

            // ONLY when testing CCIP Adapter - chain selector (domain id) is the same in all chains, so set origin chain id to origin/dest chain selector
            // Reason is that chainlink local doesn't map origin and destination chain ids
            sourceAdapter = await Adapter.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[1]],
                [ccipConfig.chainSelector_],
                ownerSigner.address
            );
            destAdapter = await Adapter.deploy(
                ccipConfig.destinationRouter_,
                "CCIP Adapter",
                100,
                treasurySigner.address,
                1000,
                [chainIds[0]],
                [ccipConfig.chainSelector_],
                ownerSigner.address
            );

            // Set trusted adapter
            await sourceAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[1], destAdapter.address);
            await destAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], sourceAdapter.address);

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
            const bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 2000000]);
            const tx = await sourceController
                .connect(user1Signer)
                .sendMessage(
                    [[randomAddress], [message], ethers.constants.HashZero, 1],
                    chainIds[1],
                    [sourceAdapter.address],
                    [300],
                    [bridgeOptions],
                    {
                        value: 300,
                    }
                );
            const receipt = await tx.wait();
            const msgCreatedEvent = receipt.events?.find((x: any) => x.event === "MessageCreated");
            const messageId = msgCreatedEvent?.args?.messageId;
            // The CCIPLocalSimulator/MockRouter should forward automatically
            expect(await destController.isReceivedMessageExecutable(messageId)).to.be.equal(true);
        });

        it("should revert if the origin sender is not trusted", async () => {
            // Remove trusted adapter for chainIds[0]
            await destAdapter.connect(ownerSigner).setTrustedAdapter(chainIds[0], ethers.constants.AddressZero);
            const message = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const bridgeOptions = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 2000000]);
            await expect(
                sourceController
                    .connect(user1Signer)
                    .sendMessage(
                        [[ethers.constants.AddressZero], [message], ethers.constants.HashZero, 1],
                        chainIds[1],
                        [sourceAdapter.address],
                        [300],
                        [bridgeOptions],
                        {value: 300}
                    )
            ).to.be.reverted;
        });
        it("should revert if not called by the router", async () => {
            const randomBytes = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [user1Signer.address, 2000000]);
            await expect(
                destAdapter
                    .connect(user1Signer)
                    .ccipReceive([ethers.utils.hexlify(ethers.utils.randomBytes(32)), ccipConfig.chainSelector_, randomBytes, randomBytes, []])
            )
                .to.be.revertedWithCustomError(destAdapter, "InvalidRouter")
                .withArgs(user1Signer.address);
        });
        // Note: CCIPLocalSimulator/MockRouter prevents double-processing at the contract level, messageIds generated are unique
    });

    describe("setDomainId", () => {
        beforeEach(async () => {
            adapter = await Adapter.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
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

    describe("collectAndRefundFees", () => {
        beforeEach(async () => {
            const AdapterMock = await ethers.getContractFactory("CCIPAdapterMock");
            adapter = await AdapterMock.deploy(
                ccipConfig.sourceRouter_,
                "CCIP Adapter",
                100,
                treasurySigner.address,
                1000, // 1%
                chainIds,
                domainIds,
                ownerSigner.address
            );
            quotedFee = ethers.utils.parseEther("1");
            protocolFee = quotedFee.div(100); // 1% of quotedFee
        });

        it("should succeed and not refund if msg.value == quotedFee + protocolFee", async () => {
            const value = quotedFee.add(protocolFee);
            await expect(adapter.connect(ownerSigner).collectAndRefundFees(quotedFee, user1Signer.address, {value})).to.changeEtherBalances(
                [adapter, treasurySigner, user1Signer],
                [quotedFee, protocolFee, 0]
            );
        });

        it("should refund excess if msg.value > quotedFee + protocolFee", async () => {
            const value = quotedFee.add(protocolFee).add(ethers.utils.parseEther("0.5"));
            await expect(adapter.connect(ownerSigner).collectAndRefundFees(quotedFee, user1Signer.address, {value})).to.changeEtherBalances(
                [adapter, treasurySigner, user1Signer],
                [quotedFee, protocolFee, ethers.utils.parseEther("0.5")]
            );
        });

        it("should revert if msg.value < quotedFee + protocolFee", async () => {
            const value = quotedFee.add(protocolFee).sub(1);
            await expect(adapter.connect(ownerSigner).collectAndRefundFees(quotedFee, user1Signer.address, {value})).to.be.revertedWithCustomError(
                adapter,
                "Adapter_FeeTooLow"
            );
        });
    });
});
