import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("XERC20VotesUpgradeable Tests", () => {
    let user1Signer: SignerWithAddress;
    let ownerSigner: SignerWithAddress;
    let user2Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let governanceToken: Contract;

    beforeEach(async () => {
        upgrades.silenceWarnings();
        [user1Signer, ownerSigner, user2Signer, treasurySigner] = await ethers.getSigners();

        // Deploy governance token
        const GovernanceToken = await ethers.getContractFactory("XERC20VotesUpgradeable");
        governanceToken = await upgrades.deployProxy(
            GovernanceToken,
            ["Test Token", "TEST", [user1Signer.address], [100], ownerSigner.address, treasurySigner.address, [], []],
            {
                initializer: "initialize",
            }
        );
        await governanceToken.deployed();
    });
    describe("constructor", () => {
        beforeEach(async () => {});
        it("should mint the number of tokens to the recipients", async () => {
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);
            expect(await governanceToken.balanceOf(ownerSigner.address)).to.be.equal(0);
        });
        it("should set name and symbol", async () => {
            expect(await governanceToken.name()).to.be.equal("Test Token");
            expect(await governanceToken.symbol()).to.be.equal("TEST");
        });
        it("should have 18 decimals", async () => {
            expect(await governanceToken.decimals()).to.be.equal(18);
        });
        it("should set the owner", async () => {
            expect(await governanceToken.owner()).to.be.equal(ownerSigner.address);
        });
        it("should set the treasury", async () => {
            expect(await governanceToken.treasury()).to.be.equal(treasurySigner.address);
        });
        it("should not set the bridge tax tiers if they are not provided", async () => {
            // bridgeTaxTiers should revert if empty
            await expect(governanceToken.bridgeTaxTiers(0)).to.be.reverted;
        });
        it("should set the bridge tax tiers", async () => {
            // Deploy governance token
            const GovernanceToken = await ethers.getContractFactory("XERC20Votes");
            governanceToken = await GovernanceToken.deploy(
                "Test Token",
                "TEST",
                [user1Signer.address],
                [100],
                ownerSigner.address,
                treasurySigner.address,
                [ethers.utils.parseEther("50"), ethers.utils.parseEther("500")],
                [100, 200]
            );
            const bridgeTaxTiers = await governanceToken.bridgeTaxTiers(0);
            expect(bridgeTaxTiers.threshold).to.be.equal(ethers.utils.parseEther("50"));
            expect(bridgeTaxTiers.basisPoints).to.be.equal(100);
            const bridgeTaxTiers2 = await governanceToken.bridgeTaxTiers(1);
            expect(bridgeTaxTiers2.threshold).to.be.equal(ethers.utils.parseEther("500"));
            expect(bridgeTaxTiers2.basisPoints).to.be.equal(200);
        });
    });
    describe("constructor - multiple recipients", () => {
        beforeEach(async () => {
            // Deploy governance token
            const GovernanceToken = await ethers.getContractFactory("XERC20VotesUpgradeable");
            governanceToken = await upgrades.deployProxy(
                GovernanceToken,
                ["Test Token", "TEST", [user1Signer.address, ownerSigner.address], [100, 200], ownerSigner.address, treasurySigner.address, [], []],
                {
                    initializer: "initialize",
                }
            );
            await governanceToken.deployed();
        });
        it("should mint the number of tokens to onBehalfOf specified in constructor", async () => {
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);
            expect(await governanceToken.balanceOf(ownerSigner.address)).to.be.equal(200);
        });
    });
    describe("mint", () => {
        beforeEach(async () => {});
        describe("when user is not the owner", () => {
            it("should revert if the user is not the owner", async () => {
                await expect(governanceToken.connect(user1Signer).mint(ownerSigner.address, 100)).to.be.revertedWithCustomError(
                    governanceToken,
                    "IXERC20_NotHighEnoughLimits"
                );
            });
        });
        describe("when user is the owner", () => {
            it("should mint tokens to the destination address", async () => {
                await governanceToken.connect(ownerSigner).mint(ownerSigner.address, 100);
                expect(await governanceToken.balanceOf(ownerSigner.address)).to.be.equal(100);
            });
        });
        describe("when caller is the bridge", () => {
            beforeEach(async () => {
                await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
            });
            it("should mint tokens to the destination address", async () => {
                await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
                expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(100);
            });
        });
        describe("when bridge tax is enabled", () => {
            beforeEach(async () => {
                await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);

                await governanceToken
                    .connect(ownerSigner)
                    .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
            });
            it("should mint tokens to the treasury address", async () => {
                const taxAmount = await governanceToken.calculateBridgeTax(100);
                await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
                expect(await governanceToken.balanceOf(treasurySigner.address)).to.be.equal(taxAmount);
            });
            it("should mint a reduced amount to the user", async () => {
                const taxAmount = await governanceToken.calculateBridgeTax(100);
                await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
                expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(100 - taxAmount);
            });
            it("should emit BridgeTaxCollected event", async () => {
                const taxAmount = await governanceToken.calculateBridgeTax(100);
                expect(await governanceToken.connect(user1Signer).mint(user2Signer.address, 100))
                    .to.emit(governanceToken, "BridgeTaxCollected")
                    .withArgs(user2Signer.address, 100, taxAmount);
            });
            it("should not trigger the tax is the tax is set but the treasury is the zero address", async () => {
                await governanceToken.connect(ownerSigner).setTreasury(ethers.constants.AddressZero);
                await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
                expect(await governanceToken.balanceOf(treasurySigner.address)).to.be.equal(0);
            });
        });
    });
    describe("burn(address, amount)", () => {
        beforeEach(async () => {
            await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
            await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
        });
        it("should burn tokens from the destination address", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(user2Signer).approve(user1Signer.address, 100);
            await governanceToken.connect(user1Signer)["burn(address,uint256)"](user2Signer.address, 100);
            expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(0);
        });
        it("should revert if the owner attempts to burn tokens of others", async () => {
            // user1Signer already holds tokens
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);

            // should revert if the owner attempts to burn tokens of others
            await expect(governanceToken.connect(ownerSigner)["burn(address,uint256)"](user2Signer.address, 100)).to.be.revertedWith(
                "ERC20: insufficient allowance"
            );
        });
        it("should revert if the bridge does not have enough allowance", async () => {
            await expect(governanceToken.connect(user1Signer)["burn(address,uint256)"](user2Signer.address, 100)).to.be.revertedWith(
                "ERC20: insufficient allowance"
            );
        });
        it("should revert if the user does not have burn rights", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(ownerSigner).approve(user2Signer.address, 100);
            await expect(governanceToken.connect(user2Signer)["burn(address,uint256)"](ownerSigner.address, 100)).to.be.revertedWithCustomError(
                governanceToken,
                "IXERC20_NotHighEnoughLimits"
            );
        });
        it("should burn their own tokens if msg.sender has burn limits", async () => {
            // user1 has 100 tokens
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);
            await governanceToken.connect(user1Signer)["burn(address,uint256)"](user1Signer.address, 100);
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(0);
            expect(await governanceToken.burningCurrentLimitOf(user1Signer.address)).to.be.not.equal(1000);
        });
    });
    describe("burnFrom", () => {
        beforeEach(async () => {
            await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
            await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
        });
        it("should burn tokens from the destination address", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(user2Signer).approve(user1Signer.address, 100);
            await governanceToken.connect(user1Signer).burnFrom(user2Signer.address, 100);
            expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(0);
        });
        it("should revert if the owner attempts to burn tokens of others", async () => {
            // user1Signer already holds tokens
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);

            // should revert if the owner attempts to burn tokens of others
            await expect(governanceToken.connect(ownerSigner).burnFrom(user2Signer.address, 100)).to.be.revertedWith("ERC20: insufficient allowance");
        });
        it("should revert if the bridge does not have enough allowance", async () => {
            await expect(governanceToken.connect(user1Signer).burnFrom(user2Signer.address, 100)).to.be.revertedWith("ERC20: insufficient allowance");
        });
        it("should revert if the user does not have burn rights", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(ownerSigner).approve(user2Signer.address, 100);
            await expect(governanceToken.connect(user2Signer).burnFrom(ownerSigner.address, 100)).to.be.revertedWithCustomError(
                governanceToken,
                "IXERC20_NotHighEnoughLimits"
            );
        });
        it("should burn their own tokens if msg.sender has burn limits", async () => {
            // user1 has 100 tokens
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);
            await governanceToken.connect(user1Signer).burnFrom(user1Signer.address, 100);
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(0);
            expect(await governanceToken.burningCurrentLimitOf(user1Signer.address)).to.be.not.equal(1000);
        });
    });
    describe("burn(amount)", () => {
        beforeEach(async () => {
            await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
        });
        it("should burn tokens from the destination address", async () => {
            // User 1 has tokens
            await governanceToken.connect(user1Signer)["burn(uint256)"](100);
            expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(0);
        });
        it("should revert if the owner does not have enough tokens", async () => {
            // user1Signer already holds tokens
            expect(await governanceToken.balanceOf(user1Signer.address)).to.be.equal(100);
            await expect(governanceToken.connect(user1Signer)["burn(uint256)"](200)).to.be.revertedWith("ERC20: burn amount exceeds balance");
        });
        it("should revert if the user does not have burn rights", async () => {
            await governanceToken.connect(user1Signer).mint(user2Signer.address, 100);
            await expect(governanceToken.connect(user2Signer)["burn(uint256)"](100)).to.be.revertedWithCustomError(
                governanceToken,
                "IXERC20_NotHighEnoughLimits"
            );
        });
    });
    describe("crosschainMint", () => {
        beforeEach(async () => {
            await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
        });
        it("should mint tokens to the destination address", async () => {
            await governanceToken.connect(user1Signer).crosschainMint(user2Signer.address, 100);
            expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(100);
        });
        it("should emit CrosschainMint event", async () => {
            expect(await governanceToken.connect(user1Signer).crosschainMint(user2Signer.address, 100))
                .to.emit(governanceToken, "CrosschainMint")
                .withArgs(user2Signer.address, 100, user1Signer.address);
        });
        it("should revert if the user does not have mint rights", async () => {
            await expect(governanceToken.connect(ownerSigner).crosschainMint(user2Signer.address, 100)).to.be.revertedWithCustomError(
                governanceToken,
                "IXERC20_NotHighEnoughLimits"
            );
        });
        describe("when bridge tax is enabled", () => {
            beforeEach(async () => {
                await governanceToken
                    .connect(ownerSigner)
                    .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
            });
            it("should mint tokens to the treasury address", async () => {
                const taxAmount = await governanceToken.calculateBridgeTax(100);
                await governanceToken.connect(user1Signer).crosschainMint(user2Signer.address, 100);
                expect(await governanceToken.balanceOf(treasurySigner.address)).to.be.equal(taxAmount);
            });
        });
    });
    describe("crosschainBurn", () => {
        beforeEach(async () => {
            await governanceToken.connect(ownerSigner).setLimits(user1Signer.address, 1000, 1000);
            await governanceToken.connect(user1Signer).crosschainMint(user2Signer.address, 100);
        });
        it("should burn tokens from the destination address", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(user2Signer).approve(user1Signer.address, 100);
            await governanceToken.connect(user1Signer).crosschainBurn(user2Signer.address, 100);
            expect(await governanceToken.balanceOf(user2Signer.address)).to.be.equal(0);
        });
        it("should emit CrosschainBurn event", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(user2Signer).approve(user1Signer.address, 100);
            expect(await governanceToken.connect(user1Signer).crosschainBurn(user2Signer.address, 100))
                .to.emit(governanceToken, "CrosschainBurn")
                .withArgs(user2Signer.address, 100, user1Signer.address);
        });
        it("should revert if the user does not have enough allowance", async () => {
            await expect(governanceToken.connect(user1Signer).crosschainBurn(user2Signer.address, 100)).to.be.revertedWith(
                "ERC20: insufficient allowance"
            );
        });
        it("should revert if the user does not have burn rights", async () => {
            // User 2 approves the owner(bridge) to spend 100 tokens
            await governanceToken.connect(user2Signer).approve(ownerSigner.address, 100);
            await expect(governanceToken.connect(ownerSigner).crosschainBurn(user2Signer.address, 100)).to.be.revertedWithCustomError(
                governanceToken,
                "IXERC20_NotHighEnoughLimits"
            );
        });
    });
    describe("introspection", () => {
        it("should return true for supportsInterface for IERC7802", async () => {
            expect(await governanceToken.supportsInterface(0x33331994)).to.be.equal(true);
        });
        it("should return true for supportsInterface for IERC165", async () => {
            expect(await governanceToken.supportsInterface(0x01ffc9a7)).to.be.equal(true);
        });
    });
    describe("setLimits", () => {
        it("should revert if the caller is not the owner", async () => {
            await expect(
                governanceToken
                    .connect(user1Signer)
                    .setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("100"), ethers.utils.parseEther("100"))
            ).to.be.reverted;
        });
        it("should revert if the new minting limits are > (uint256 max / 2)", async () => {
            await expect(
                governanceToken
                    .connect(ownerSigner)
                    .setLimits(ethers.constants.AddressZero, ethers.constants.MaxUint256.div(2).add(1), ethers.utils.parseEther("100"))
            ).to.be.revertedWithCustomError(governanceToken, "Token_LimitsTooHigh");
        });
        it("should revert if the new burning limits are > (uint256 max / 2)", async () => {
            await expect(
                governanceToken
                    .connect(ownerSigner)
                    .setLimits(ethers.constants.AddressZero, ethers.utils.parseEther("100"), ethers.constants.MaxUint256.div(2).add(1))
            ).to.be.revertedWithCustomError(governanceToken, "Token_LimitsTooHigh");
        });
    });
    describe("setBridgeTaxTiers", () => {
        beforeEach(async () => {});
        it("should delete the bridge tax tiers if the array is empty", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
            expect(await governanceToken.isBridgeTaxEnabled()).to.be.equal(true);
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([], []);
            expect(await governanceToken.isBridgeTaxEnabled()).to.be.equal(false);
        });
        it("should set the bridge tax tiers", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
            const bridgeTaxTiers = await governanceToken.bridgeTaxTiers(0);
            expect(bridgeTaxTiers.threshold).to.be.equal(ethers.utils.parseEther("50"));
            expect(bridgeTaxTiers.basisPoints).to.be.equal(100);
            const bridgeTaxTiers2 = await governanceToken.bridgeTaxTiers(1);
            expect(bridgeTaxTiers2.threshold).to.be.equal(ethers.utils.parseEther("500"));
            expect(bridgeTaxTiers2.basisPoints).to.be.equal(200);
        });
        it("should emit BridgeTaxTiersUpdated event", async () => {
            expect(
                await governanceToken
                    .connect(ownerSigner)
                    .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200])
            )
                .to.emit(governanceToken, "BridgeTaxTiersUpdated")
                .withArgs(ownerSigner.address, [ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
        });
        it("should delete the previous bridge tax tiers before setting new ones", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100, 200]);
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("100"), ethers.utils.parseEther("1000")], [300, 400]);
            const bridgeTaxTiers = await governanceToken.bridgeTaxTiers(0);
            expect(bridgeTaxTiers.threshold).to.be.equal(ethers.utils.parseEther("100"));
            expect(bridgeTaxTiers.basisPoints).to.be.equal(300);
            const bridgeTaxTiers2 = await governanceToken.bridgeTaxTiers(1);
            expect(bridgeTaxTiers2.threshold).to.be.equal(ethers.utils.parseEther("1000"));
            expect(bridgeTaxTiers2.basisPoints).to.be.equal(400);
            // there is no 3rd element in the array
            await expect(governanceToken.bridgeTaxTiers(2)).to.be.reverted;
        });
        it("should revert if the arrays are not of the same length", async () => {
            await expect(
                governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [100])
            ).to.be.revertedWithCustomError(governanceToken, "Token_InvalidParams");
            await expect(
                governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50")], [100, 200])
            ).to.be.revertedWithCustomError(governanceToken, "Token_InvalidParams");
        });
        it("should revert if the threshold array has more than 10 elements", async () => {
            await expect(
                governanceToken
                    .connect(ownerSigner)
                    .setBridgeTaxTiers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100])
            ).to.be.revertedWithCustomError(governanceToken, "Token_InvalidParams");
        });
        it("should revert if the threshold array has an element that is zero other than the first one", async () => {
            await expect(governanceToken.connect(ownerSigner).setBridgeTaxTiers([0, 0, 2], [10, 20, 30])).to.be.revertedWithCustomError(
                governanceToken,
                "Token_InvalidParams"
            );
        });
        it("should not revert if the threshold array has an element that is zero and the first one", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([0, 1, 2], [10, 20, 30]);
            const bridgeTaxTiers = await governanceToken.bridgeTaxTiers(0);
            expect(bridgeTaxTiers.threshold).to.be.equal(0);
            expect(bridgeTaxTiers.basisPoints).to.be.equal(10);
        });
        it("should revert if the thresholds are not in ascending order", async () => {
            await expect(governanceToken.connect(ownerSigner).setBridgeTaxTiers([1, 3, 2], [10, 20, 30])).to.be.revertedWithCustomError(
                governanceToken,
                "Token_InvalidParams"
            );
        });
        it("should revert if the basis points array has an element that is greater than MAX_TAX_BASIS_POINTS", async () => {
            const maxTaxBasisPoints = await governanceToken.MAX_TAX_BASIS_POINTS();
            await expect(
                governanceToken.connect(ownerSigner).setBridgeTaxTiers([1, 2, 3], [1000, 2000, maxTaxBasisPoints + 1])
            ).to.be.revertedWithCustomError(governanceToken, "Token_InvalidParams");
        });
        it("should revert if zero is passed as a threshold and basis points", async () => {
            await expect(governanceToken.connect(ownerSigner).setBridgeTaxTiers([0], [0])).to.be.revertedWithCustomError(
                governanceToken,
                "Token_InvalidParams"
            );
        });
    });
    describe("setTreasury", () => {
        it("should revert if the user is not the owner", async () => {
            await expect(governanceToken.connect(user1Signer).setTreasury(user2Signer.address)).to.be.revertedWithCustomError(
                governanceToken,
                "OwnableUnauthorizedAccount"
            );
        });
        it("should set the treasury", async () => {
            await governanceToken.connect(ownerSigner).setTreasury(user2Signer.address);
            expect(await governanceToken.treasury()).to.be.equal(user2Signer.address);
        });
        it("should emit TreasuryUpdated event", async () => {
            expect(await governanceToken.connect(ownerSigner).setTreasury(user2Signer.address))
                .to.emit(governanceToken, "TreasuryUpdated")
                .withArgs(ownerSigner.address, user2Signer.address);
        });
    });
    describe("isBridgeTaxEnabled", () => {
        it("should return false if the bridge tax tiers are not set", async () => {
            expect(await governanceToken.isBridgeTaxEnabled()).to.be.equal(false);
        });
        it("should return true if the bridge tax tiers are set", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50")], [100]);
            expect(await governanceToken.isBridgeTaxEnabled()).to.be.equal(true);
        });
    });
    describe("calculateBridgeTax", () => {
        it("should return 0 if the bridge tax tiers are not set", async () => {
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("100"))).to.be.equal(0);
        });
        it("should return 0 if the amount is 0", async () => {
            expect(await governanceToken.calculateBridgeTax(0)).to.be.equal(0);
        });
        it("should return 0 if the amount is up to the first threshold, if bps is 0", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [0, 100]);
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("50"))).to.be.equal(0);
        });
        it("should return the tax amount if it falls on the first tier", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [1000, 2000]);
            // 10% for up to 50
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("50"))).to.be.equal(ethers.utils.parseEther("5"));
        });
        it("should return the tax amount if it falls on the second tier", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("500")], [1000, 500]);
            // 10% for up to 50 (=5), then 5% for up to 500 (=2.5)
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("100"))).to.be.equal(ethers.utils.parseEther("7.5"));
        });
        it("should return the tax amount if it falls on the third tier", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("100"), ethers.utils.parseEther("200")], [1000, 500, 200]);
            // 10% for up to 50 (=5), then 5% for up to 100 (=2.5), then 2% for up to 200 (=1)
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("150"))).to.be.equal(ethers.utils.parseEther("8.5"));
        });
        it("should return the tax amount if it hits the last threshold", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("100"), ethers.utils.parseEther("250")], [1000, 500, 200]);
            // 10% for up to 50 (=5), then 5% for up to 100 (=2.5), then 2% for the remaining 150 (=3)
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("250"))).to.be.equal(ethers.utils.parseEther("10.5"));
        });
        it("should return the tax amount if it exceeds the last threshold", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("100"), ethers.utils.parseEther("250")], [1000, 500, 200]);
            // 10% for up to 50 (=5), then 5% for up to 100 (=2.5), then 2% for the remaining 250 (=5)
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("350"))).to.be.equal(ethers.utils.parseEther("12.5"));
        });
        it("should calculate the tax if the bps are ascending", async () => {
            await governanceToken
                .connect(ownerSigner)
                .setBridgeTaxTiers([ethers.utils.parseEther("50"), ethers.utils.parseEther("100"), ethers.utils.parseEther("250")], [200, 500, 1000]);
            // 2% for up to 50 (=1), then 5% for up to 100 (=2.5), then 10% for the remaining 250 (=25)
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("350"))).to.be.equal(ethers.utils.parseEther("28.5"));
        });
        it("should return the tax if threshold is zero, with a non-zero bps", async () => {
            await governanceToken.connect(ownerSigner).setBridgeTaxTiers([0], [100]);
            // 1% for any amount
            expect(await governanceToken.calculateBridgeTax(ethers.utils.parseEther("1000"))).to.be.equal(ethers.utils.parseEther("10"));
        });
    });
});
