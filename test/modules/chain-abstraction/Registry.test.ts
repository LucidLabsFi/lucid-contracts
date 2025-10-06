import {expect} from "chai";
import {ethers} from "hardhat";
import {Contract} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
describe("Registry Tests", () => {
    let registry: Contract;
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let user2Signer: SignerWithAddress;
    let bridgeAdapter1: Contract;
    let bridgeAdapter2: Contract;

    beforeEach(async () => {
        [ownerSigner, user1Signer, user2Signer] = await ethers.getSigners();
    });
    describe("constructor", () => {
        it("should set the initial adapters correctly", async () => {
            const initialAdapters = [ownerSigner.address, user1Signer.address];
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy(initialAdapters, ownerSigner.address);
            await registry.deployed();

            for (let i = 0; i < initialAdapters.length; i++) {
                expect(await registry.isLocalAdapter(initialAdapters[i])).to.be.true;
            }
        });
        it("should execute if the initial adapters array is empty", async () => {
            const Registry = await ethers.getContractFactory("Registry");
            await expect(Registry.deploy([], ownerSigner.address)).not.to.be.reverted;
        });
        it("should set the contract owner", async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([], user1Signer.address);
            expect(await registry.owner()).to.equal(user1Signer.address);
        });
    });
    describe("setAdapters", () => {
        beforeEach(async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([ownerSigner.address], ownerSigner.address);
            await registry.deployed();
        });
        it("should revert if the caller is not the owner", async () => {
            await expect(registry.connect(user1Signer).setAdapters([user1Signer.address], [true])).to.be.revertedWithCustomError(
                registry,
                "OwnableUnauthorizedAccount"
            );
        });
        it("should revert if adapters and enabled arrays have different lengths", async () => {
            await expect(registry.connect(ownerSigner).setAdapters([user1Signer.address], [true, false])).to.be.revertedWithCustomError(
                registry,
                "Registry_Invalid_Params"
            );

            await expect(registry.connect(ownerSigner).setAdapters([user1Signer.address, user2Signer.address], [true])).to.be.revertedWithCustomError(
                registry,
                "Registry_Invalid_Params"
            );
        });
        it("should set the adapter status correctly", async () => {
            const adapters = [user1Signer.address, user2Signer.address];
            const statuses = [true, false];

            await registry.connect(ownerSigner).setAdapters(adapters, statuses);

            for (let i = 0; i < adapters.length; i++) {
                expect(await registry.isLocalAdapter(adapters[i])).to.equal(statuses[i]);
            }
        });
        it("should emit AdapterSet events", async () => {
            const adapters = [user1Signer.address, user2Signer.address];
            const statuses = [true, false];

            const tx = await registry.connect(ownerSigner).setAdapters(adapters, statuses);

            for (let i = 0; i < adapters.length; i++) {
                await expect(tx).to.emit(registry, "AdapterSet").withArgs(adapters[i], statuses[i]);
            }
        });
    });
    describe("isLocalAdapter", () => {
        beforeEach(async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([ownerSigner.address], ownerSigner.address);
            await registry.deployed();
        });
        it("should return true if the adapter is approved", async () => {
            await registry.connect(ownerSigner).setAdapters([user1Signer.address], [true]);

            const isApproved = await registry.isLocalAdapter(user1Signer.address);
            expect(isApproved).to.be.true;
        });
        it("should return false if the adapter is not approved", async () => {
            await registry.connect(ownerSigner).setAdapters([user1Signer.address], [false]);

            const isApproved = await registry.isLocalAdapter(user1Signer.address);
            expect(isApproved).to.be.false;
        });
        it("should return false if the adapter is not set", async () => {
            const isApproved = await registry.isLocalAdapter(user1Signer.address);
            expect(isApproved).to.be.false;
        });
    });
    describe("getSupportedBridgesForChain", () => {
        beforeEach(async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([], ownerSigner.address);
            await registry.deployed();
            // Deploy Mock adapters

            const Connext = await ethers.getContractFactory("ConnextMock");
            const connext = await Connext.deploy();

            const BridgeAdapter = await ethers.getContractFactory("ConnextAdapter");
            bridgeAdapter1 = await BridgeAdapter.deploy(
                connext.address,
                "Connext Adapter",
                0,
                ethers.constants.AddressZero,
                0,
                [2],
                [200],
                ownerSigner.address
            );
            bridgeAdapter2 = await BridgeAdapter.deploy(
                connext.address,
                "Connext 2 Adapter",
                0,
                ethers.constants.AddressZero,
                0,
                [1],
                [100],
                ownerSigner.address
            );

            await bridgeAdapter1.setTrustedAdapter(2, bridgeAdapter2.address);
            await bridgeAdapter2.setTrustedAdapter(1, bridgeAdapter1.address);
            await registry.connect(ownerSigner).setAdapters([bridgeAdapter1.address, bridgeAdapter2.address], [true, true]);
        });
        it("should return an empty array if no adapters support the given chain ID", async () => {
            const chainId = 5;
            const supportedBridges = await registry.getSupportedBridgesForChain(chainId);
            expect(supportedBridges).to.be.empty;
        });
        it("should return the list of adapters that support the given chain ID", async () => {
            const supportedBridges = await registry.getSupportedBridgesForChain(2);
            expect(supportedBridges).to.deep.equal([bridgeAdapter1.address]);
        });
    });
    describe("getSupportedChainsForAdapter", () => {
        beforeEach(async () => {
            const Registry = await ethers.getContractFactory("Registry");
            registry = await Registry.deploy([], ownerSigner.address);
            await registry.deployed();
            await registry.connect(ownerSigner).addChainIds([1, 2, 3]);
            // Deploy Mock adapters

            const Connext = await ethers.getContractFactory("ConnextMock");
            const connext = await Connext.deploy();

            const BridgeAdapter = await ethers.getContractFactory("ConnextAdapter");
            bridgeAdapter1 = await BridgeAdapter.deploy(
                connext.address,
                "Connext Adapter",
                0,
                ethers.constants.AddressZero,
                0,
                [2],
                [200],
                ownerSigner.address
            );
            bridgeAdapter2 = await BridgeAdapter.deploy(
                connext.address,
                "Connext 2 Adapter",
                0,
                ethers.constants.AddressZero,
                0,
                [1],
                [100],
                ownerSigner.address
            );

            await bridgeAdapter1.setTrustedAdapter(2, bridgeAdapter2.address);
            await registry.connect(ownerSigner).setAdapters([bridgeAdapter1.address, bridgeAdapter2.address], [true, true]);
        });
        it("should return an empty array if no adapters support the given chain ID", async () => {
            const supportedAdapters = await registry.getSupportedChainsForAdapter(bridgeAdapter2.address);
            expect(supportedAdapters).to.be.empty;
        });
        it("should revert if msg.sender is not messageOriginator", async () => {
            await expect(registry.getSupportedChainsForAdapter(ownerSigner.address)).to.be.revertedWithCustomError(registry, "Registry_NotAdapter");
        });
        it("should return the list of adapters that support the given chain ID", async () => {
            const supportedAdapters = await registry.getSupportedChainsForAdapter(bridgeAdapter1.address);
            expect(supportedAdapters).to.deep.equal([2]);
        });
    });
});
