import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("Proxy Factory Tests", () => {
    const quadraticThreshold = 0;

    let deployer: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let deployerAddress: string;

    let proxyFactory: Contract;
    let adminFactory: Contract;
    let token: any;
    let Token: Contract;

    beforeEach(async () => {
        [deployer, user1Signer] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        upgrades.silenceWarnings();

        // Deploy XERC20VotesUpgradeable Token
        const Token = await ethers.getContractFactory("XERC20VotesUpgradeable");
        token = await upgrades.deployImplementation(Token);
        //console.log("Implementation of XERC20VotesUpgradeable deployed to:", token);
        console.log("typeof", typeof token);
        const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
        proxyFactory = await ProxyFactory.deploy();
        //console.log("ProxyFactory deployed to:", proxyFactory.address);

        const AdminFactory = await ethers.getContractFactory("ProxyAdminFactory");
        adminFactory = await AdminFactory.deploy();
        //console.log("ProxyAdminFactory deployed to:", adminFactory.address);
    });
    describe("Deploy a token proxy via the factory", () => {
        beforeEach(async () => {
            // Encode function params for initializer
            let ABI = [
                "function initialize(string name, string symbol, address[] recipients, uint256[] amounts, address owner, address treasury, uint256[] bridgeTaxTierThresholds, uint256[] bridgeTaxTierBasisPoints)",
            ];
            let iface = new ethers.utils.Interface(ABI);
            const params = iface.encodeFunctionData("initialize", [
                "TEST",
                "TST",
                ["0x11FDa09876574be36174A14637d98bf173299942"],
                [1000],
                deployerAddress,
                deployerAddress,
                [],
                [],
            ]);

            // Deploy a Proxy Admin
            const adminSalt = ethers.utils.formatBytes32String("Testing1");
            let tx = await adminFactory.deployAdmin(deployerAddress);
            let receipt = await tx.wait();
            let event = receipt.events?.filter((x: any) => {
                return x.event == "AdminDeployed";
            });
            const proxyAdmin = event ? (event[0].args ? event[0].args["proxyAdmin"] : 0) : 0;
            // console.log("Proxy Admin deployed to: ", proxyAdmin);

            // Deploy a token proxy
            // const proxySalt = ethers.utils.formatBytes32String("Testing1");
            tx = await proxyFactory.deployProxy(String(token), proxyAdmin, params);

            // Get contract address
            receipt = await tx.wait();
            event = receipt.events?.filter((x: any) => {
                return x.event == "ProxyDeployed";
            });
            const proxyAddress = event ? (event[0].args ? event[0].args["proxy"] : 0) : 0;
            //console.log("Proxy deployed to: ", proxyAddress);

            //attach and call functions
            const Token = await ethers.getContractFactory("XERC20VotesUpgradeable");
            const contract = Token.attach(proxyAddress);
            console.log("Token name", await contract.name());
        });
        it("should create a proxy with the token implementation and initialize it", async () => {});
    });
});
