import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";

describe("ControllerWrapper Tests", () => {
    let user1Signer: SignerWithAddress;
    let ownerSigner: SignerWithAddress;
    let user2Signer: SignerWithAddress;
    let treasurySigner: SignerWithAddress;
    let token: Contract;
    let controllerWrapper: Contract;
    let controller: Contract;
    let ControllerWrapper: any;
    let defaultAdminRole: any;

    const duration = 86400; // 1 day
    const rate = 10; // 0.01%
    const maxFeeRate = 5000; // 5%

    // NOTE 100_000 is 100%

    beforeEach(async () => {
        upgrades.silenceWarnings();
        [ownerSigner, user1Signer, user2Signer, treasurySigner] = await ethers.getSigners();

        // Deploy token
        const Token = await ethers.getContractFactory("XERC20Votes");
        token = await Token.deploy(
            "Test Token",
            "TEST",
            [ownerSigner.address, user1Signer.address],
            [ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000")],
            ownerSigner.address,
            ethers.constants.AddressZero,
            [],
            []
        );

        // Deploy controller
        const AssetController = await ethers.getContractFactory("AssetControllerSingleMock");
        controller = await AssetController.deploy(token.address);

        // // Deploy controller wrapper
        // const ControllerWrapper = await ethers.getContractFactory("ControllerWrapper");
        // controllerWrapper = await ControllerWrapper.deploy(
        //     [ownerSigner.address, user1Signer.address],
        //     treasurySigner.address,
        //     100,
        //     [controller.address],
        //     [],
        //     []
        // );
    });

    describe("constructor", () => {
        beforeEach(async () => {
            ControllerWrapper = await ethers.getContractFactory("ControllerWrapper");
        });

        it("should set admin and controller manager roles", async () => {
            controllerWrapper = await ControllerWrapper.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            expect(await controllerWrapper.hasRole(await controllerWrapper.DEFAULT_ADMIN_ROLE(), ownerSigner.address)).to.be.true;
            expect(await controllerWrapper.hasRole(await controllerWrapper.CONTROLLER_MANAGER_ROLE(), user1Signer.address)).to.be.true;
        });

        it("should set the treasury and feeRate", async () => {
            controllerWrapper = await ControllerWrapper.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1234,
                [controller.address],
                [],
                []
            );
            expect(await controllerWrapper.treasury()).to.equal(treasurySigner.address);
            expect(await controllerWrapper.feeRate()).to.equal(1234);
        });

        it("should revert if treasury is zero and feeRate > 0", async () => {
            await expect(
                ControllerWrapper.deploy([ownerSigner.address, user1Signer.address], ethers.constants.AddressZero, 100, [controller.address], [], [])
            ).to.be.revertedWithCustomError(ControllerWrapper, "Wrapper_TreasuryZeroAddress");
        });

        it("should revert if feeRate > MAX_FEE_RATE", async () => {
            await expect(
                ControllerWrapper.deploy(
                    [ownerSigner.address, user1Signer.address],
                    treasurySigner.address,
                    maxFeeRate + 1,
                    [controller.address],
                    [],
                    []
                )
            ).to.be.revertedWithCustomError(ControllerWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should whitelist initial controllers", async () => {
            controllerWrapper = await ControllerWrapper.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            expect(await controllerWrapper.controllers(controller.address)).to.be.true;
        });

        it("should not revert if initialControllers is empty", async () => {
            controllerWrapper = await ControllerWrapper.deploy([ownerSigner.address, user1Signer.address], treasurySigner.address, 100, [], [], []);
            // No revert, contract deployed
            expect(await controllerWrapper.treasury()).to.equal(treasurySigner.address);
        });

        it("should revert if premiumChainIds and premiumRate length mismatch", async () => {
            await expect(
                ControllerWrapper.deploy([ownerSigner.address, user1Signer.address], treasurySigner.address, 100, [controller.address], [1, 2], [100])
            ).to.be.revertedWithCustomError(ControllerWrapper, "Wrapper_LengthMismatch");
        });

        it("should revert if any premiumRate > MAX_FEE_RATE", async () => {
            await expect(
                ControllerWrapper.deploy(
                    [ownerSigner.address, user1Signer.address],
                    treasurySigner.address,
                    100,
                    [controller.address],
                    [1],
                    [maxFeeRate + 1]
                )
            ).to.be.revertedWithCustomError(ControllerWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should set destChainPremiumRate for each chain", async () => {
            controllerWrapper = await ControllerWrapper.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [1, 2],
                [100, 200]
            );
            expect(await controllerWrapper.destChainPremiumRate(1)).to.equal(100);
            expect(await controllerWrapper.destChainPremiumRate(2)).to.equal(200);
        });
    });
    describe("setControllers", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            defaultAdminRole = await controllerWrapper.DEFAULT_ADMIN_ROLE();
        });

        it("should allow admin to whitelist and unwhitelist controllers", async () => {
            expect(await controllerWrapper.controllers(controller.address)).to.be.true;
            await controllerWrapper.connect(ownerSigner).setControllers([user2Signer.address], [true]);
            expect(await controllerWrapper.controllers(user2Signer.address)).to.be.true;
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            expect(await controllerWrapper.controllers(controller.address)).to.be.false;
        });

        it("should allow controller manager to whitelist controllers", async () => {
            await controllerWrapper.connect(user1Signer).setControllers([user2Signer.address], [true]);
            expect(await controllerWrapper.controllers(user2Signer.address)).to.be.true;
        });

        it("should revert if caller is not admin or manager", async () => {
            await expect(controllerWrapper.connect(user2Signer).setControllers([user2Signer.address], [true])).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_Unauthorized"
            );
        });

        it("should revert if array lengths mismatch", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setControllers([user2Signer.address], [])).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_LengthMismatch"
            );
        });
    });
    describe("setFeeRate", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
        });

        it("should allow admin to set feeRate", async () => {
            await controllerWrapper.connect(ownerSigner).setFeeRate(200);
            expect(await controllerWrapper.feeRate()).to.equal(200);
        });

        it("should allow manager to set feeRate", async () => {
            await controllerWrapper.connect(user1Signer).setFeeRate(200);
            expect(await controllerWrapper.feeRate()).to.equal(200);
        });

        it("should emit FeeRateSet event", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setFeeRate(300)).to.emit(controllerWrapper, "FeeRateSet").withArgs(100, 300);
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user2Signer).setFeeRate(200)).to.be.reverted;
        });

        it("should revert if newRate > MAX_FEE_RATE", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setFeeRate(maxFeeRate + 1)).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_InvalidFeeRate"
            );
        });

        it("should revert if newRate > 0 and treasury is zero", async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            const wrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                ethers.constants.AddressZero,
                0,
                [controller.address],
                [],
                []
            );
            await expect(wrapper.connect(ownerSigner).setFeeRate(100)).to.be.revertedWithCustomError(wrapper, "Wrapper_TreasuryZeroAddress");
        });
    });
    describe("setDestChainPremiumRate", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
        });

        it("should allow admin to set destChainPremiumRate", async () => {
            await controllerWrapper.connect(ownerSigner).setDestChainPremiumRate([1, 2], [111, 222]);
            expect(await controllerWrapper.destChainPremiumRate(1)).to.equal(111);
            expect(await controllerWrapper.destChainPremiumRate(2)).to.equal(222);
        });

        it("should allow manager to set destChainPremiumRate", async () => {
            await controllerWrapper.connect(user1Signer).setDestChainPremiumRate([1, 2], [111, 222]);
            expect(await controllerWrapper.destChainPremiumRate(1)).to.equal(111);
            expect(await controllerWrapper.destChainPremiumRate(2)).to.equal(222);
        });

        it("should emit DestChainPremiumSet event", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setDestChainPremiumRate([1], [123]))
                .to.emit(controllerWrapper, "DestChainPremiumSet")
                .withArgs(1, 123);
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user2Signer).setDestChainPremiumRate([1], [123])).to.be.reverted;
        });

        it("should revert if array lengths mismatch", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setDestChainPremiumRate([1, 2], [123])).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_LengthMismatch"
            );
        });

        it("should revert if any rate > MAX_FEE_RATE", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setDestChainPremiumRate([1], [maxFeeRate + 1])).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_InvalidFeeRate"
            );
        });
    });
    describe("setTreasury", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
        });

        it("should allow admin to set treasury", async () => {
            await controllerWrapper.connect(ownerSigner).setTreasury(user2Signer.address);
            expect(await controllerWrapper.treasury()).to.equal(user2Signer.address);
        });

        it("should emit TreasurySet event", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setTreasury(user2Signer.address))
                .to.emit(controllerWrapper, "TreasurySet")
                .withArgs(treasurySigner.address, user2Signer.address);
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user1Signer).setTreasury(user2Signer.address)).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should revert if newTreasury is zero address", async () => {
            await expect(controllerWrapper.connect(ownerSigner).setTreasury(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
                controllerWrapper,
                "Wrapper_TreasuryZeroAddress"
            );
        });
    });
    describe("setControllerFeeTiers", () => {
        let destChainId: number;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            destChainId = 123;
        });

        it("should allow admin to set a single tier and read it back", async () => {
            await controllerWrapper
                .connect(ownerSigner)
                .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100")], [200]);
            const [thresholds, rate] = await controllerWrapper.getControllerFeeTiers(controller.address, destChainId);
            expect(thresholds.length).to.equal(1);
            expect(thresholds[0]).to.equal(ethers.utils.parseEther("100"));
            expect(rate[0]).to.equal(200);
        });

        it("should allow admin to set multiple tiers and read them back", async () => {
            await controllerWrapper
                .connect(ownerSigner)
                .setControllerFeeTiers(
                    controller.address,
                    [destChainId],
                    [ethers.utils.parseEther("100"), ethers.utils.parseEther("500")],
                    [200, 400]
                );
            const [thresholds, rate] = await controllerWrapper.getControllerFeeTiers(controller.address, destChainId);
            expect(thresholds.length).to.equal(2);
            expect(thresholds[0]).to.equal(ethers.utils.parseEther("100"));
            expect(thresholds[1]).to.equal(ethers.utils.parseEther("500"));
            expect(rate[0]).to.equal(200);
            expect(rate[1]).to.equal(400);
        });

        it("should allow admin to set three tiers and read them back", async () => {
            await controllerWrapper
                .connect(ownerSigner)
                .setControllerFeeTiers(
                    controller.address,
                    [destChainId],
                    [ethers.utils.parseEther("100"), ethers.utils.parseEther("500"), ethers.utils.parseEther("1000")],
                    [200, 400, 800]
                );
            const [thresholds, rate] = await controllerWrapper.getControllerFeeTiers(controller.address, destChainId);
            expect(thresholds.length).to.equal(3);
            expect(thresholds[2]).to.equal(ethers.utils.parseEther("1000"));
            expect(rate[2]).to.equal(800);
        });

        it("should revert if not admin or manager", async () => {
            await expect(
                controllerWrapper
                    .connect(user2Signer)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100")], [200])
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_Unauthorized");
        });

        it("should revert if thresholds and rate length mismatch", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner).setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100")], [])
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_LengthMismatch");
        });

        it("should revert if more than 3 tiers", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner).setControllerFeeTiers(controller.address, [destChainId], [1, 2, 3, 4], [100, 200, 300, 400])
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_LengthMismatch");
        });

        it("should revert if rate > MAX_FEE_RATE", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100")], [maxFeeRate + 1])
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_InvalidFeeRate");
        });

        it("should revert if thresholds are not strictly ascending", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("50")],
                        [100, 200]
                    )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_InvalidParams");
        });

        it("should revert if threshold is zero except for first tier", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100"), 0], [100, 200])
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_InvalidParams");
        });

        it("should allow threshold zero for first tier", async () => {
            await controllerWrapper
                .connect(ownerSigner)
                .setControllerFeeTiers(controller.address, [destChainId], [0, ethers.utils.parseEther("100")], [100, 200]);
            const [thresholds, rate] = await controllerWrapper.getControllerFeeTiers(controller.address, destChainId);
            expect(thresholds[0]).to.equal(0);
            expect(rate[0]).to.equal(100);
        });

        it("should emit ControllerFeeTiersSet event", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("100")], [200])
            ).to.emit(controllerWrapper, "ControllerFeeTiersSet");
        });

        it("should set tiers for multiple destChainIds", async () => {
            await controllerWrapper.connect(ownerSigner).setControllerFeeTiers(controller.address, [1, 2], [ethers.utils.parseEther("100")], [200]);
            const [thresholds1, rate1] = await controllerWrapper.getControllerFeeTiers(controller.address, 1);
            const [thresholds2, rate2] = await controllerWrapper.getControllerFeeTiers(controller.address, 2);
            expect(thresholds1[0]).to.equal(ethers.utils.parseEther("100"));
            expect(rate1[0]).to.equal(200);
            expect(thresholds2[0]).to.equal(ethers.utils.parseEther("100"));
            expect(rate2[0]).to.equal(200);
        });

        describe("quote() with two tiered fees", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("500")],
                        [1000, 500]
                    );
            });

            it("should return correct fee and net for amount in first tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("50"));
                // 1% of 50 = 0.5
                expect(fee).to.equal(ethers.utils.parseEther("0.5"));
                expect(net).to.equal(ethers.utils.parseEther("49.5"));
            });

            it("should return correct fee and net for amount in second tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("200"));
                // 1% for first 100 (=1), 0.5% for next 100 (=0.5), total 1.5
                expect(fee).to.equal(ethers.utils.parseEther("1.5"));
                expect(net).to.equal(ethers.utils.parseEther("198.5"));
            });

            it("should return correct fee and net for amount above all tiers", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("600"));
                // 1% for first 100 (=1), 0.5% for next 400 (=2), 0.5% for last 100 (=0.5), total 3.5
                expect(fee).to.equal(ethers.utils.parseEther("3.5"));
                expect(net).to.equal(ethers.utils.parseEther("596.5"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
        describe("quote() with free allowance", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("500")],
                        [0, 1000]
                    );
            });

            it("should return correct fee and net for amount in first tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("50"));
                // 0% of 50 = 0
                expect(fee).to.equal(0);
                expect(net).to.equal(ethers.utils.parseEther("50"));
            });

            it("should return correct fee and net for amount in second tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("200"));
                // 0% for first 100 (=0), 1% for next 100 (=1), total 1
                expect(fee).to.equal(ethers.utils.parseEther("1"));
                expect(net).to.equal(ethers.utils.parseEther("199"));
            });

            it("should return correct fee and net for amount above all tiers", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("600"));
                // 0% for first 100 (=0), 1% for next 400 (=4), 1% for last 100 (=1), total 5
                expect(fee).to.equal(ethers.utils.parseEther("5"));
                expect(net).to.equal(ethers.utils.parseEther("595"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
        describe("quote() with free allowance and 3 tiers", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("500"), ethers.utils.parseEther("1000")],
                        [0, 1000, 500]
                    );
            });

            it("should return correct fee and net for amount in first tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("50"));
                // 0% of 50 = 0
                expect(fee).to.equal(0);
                expect(net).to.equal(ethers.utils.parseEther("50"));
            });

            it("should return correct fee and net for amount in second tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("200"));
                // 0% for first 100 (=0), 1% for next 100 (=1), total 1
                expect(fee).to.equal(ethers.utils.parseEther("1"));
                expect(net).to.equal(ethers.utils.parseEther("199"));
            });

            it("should return correct fee and net for amount above all tiers", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("600"));
                // 0% for first 100 (=0), 1% for next 400 (=4), 0.5% for last 100 (=0.5), total 4.5
                expect(fee).to.equal(ethers.utils.parseEther("4.5"));
                expect(net).to.equal(ethers.utils.parseEther("595.5"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
        describe("quote() with 3 tiers and zero above last tier", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("500"), ethers.utils.parseEther("1000")],
                        [500, 1000, 0]
                    );
            });

            it("should return correct fee and net for amount in first tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("50"));
                // 0.5% of 50 = 0.25
                expect(fee).to.equal(ethers.utils.parseEther("0.25"));
                expect(net).to.equal(ethers.utils.parseEther("49.75"));
            });

            it("should return correct fee and net for amount in second tier", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("200"));
                // 0.5% for first 100 (=0.5), 1% for next 100 (=1), total 1.5
                expect(fee).to.equal(ethers.utils.parseEther("1.5"));
                expect(net).to.equal(ethers.utils.parseEther("198.5"));
            });

            it("should return correct fee and net for amount above all tiers", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("600"));
                // 0.5% for first 100 (=0.5), 1% for next 400 (=4), 0% for last 100 (=0), total 4.5
                expect(fee).to.equal(ethers.utils.parseEther("4.5"));
                expect(net).to.equal(ethers.utils.parseEther("595.5"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
        describe("quote() with zero fees", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("0")], [0]);
            });

            it("should return correct fee and net ", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("100"));
                // 0% of 100 = 0
                expect(fee).to.equal(0);
                expect(net).to.equal(ethers.utils.parseEther("100"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
        describe("quote() with zero fees replaced", () => {
            beforeEach(async () => {
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(
                        controller.address,
                        [destChainId],
                        [ethers.utils.parseEther("100"), ethers.utils.parseEther("500"), ethers.utils.parseEther("1000")],
                        [500, 1000, 1500]
                    );
                await controllerWrapper
                    .connect(ownerSigner)
                    .setControllerFeeTiers(controller.address, [destChainId], [ethers.utils.parseEther("0")], [0]);
            });

            it("should return correct fee and net ", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("100"));
                // 0% of 100 = 0
                expect(fee).to.equal(0);
                expect(net).to.equal(ethers.utils.parseEther("100"));
            });
            it("should return correct fee and net ", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, ethers.utils.parseEther("500"));
                // 0% of 500 = 0
                expect(fee).to.equal(0);
                expect(net).to.equal(ethers.utils.parseEther("500"));
            });

            it("should return 0 fee if amount is 0", async () => {
                const [fee, net] = await controllerWrapper.quote(controller.address, destChainId, 0);
                expect(fee).to.equal(0);
                expect(net).to.equal(0);
            });
        });
    });
    describe("quote - global feeRate", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
        });

        it("should return correct fee and net ", async () => {
            const [fee, net] = await controllerWrapper.quote(controller.address, 1, ethers.utils.parseEther("100"));
            // everything at 0.1% = 0.1
            expect(fee).to.equal(ethers.utils.parseEther("0.1"));
            expect(net).to.equal(ethers.utils.parseEther("99.9"));
        });

        it("should return 0 fee if amount is 0", async () => {
            const [fee, net] = await controllerWrapper.quote(controller.address, 1, 0);
            expect(fee).to.equal(0);
            expect(net).to.equal(0);
        });
    });
    describe("quote - destination premium", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [1],
                [50]
            );
        });

        it("should return correct fee and net ", async () => {
            const [fee, net] = await controllerWrapper.quote(controller.address, 1, ethers.utils.parseEther("100"));
            // everything at 0.1% = 0.1 + destination premium 0.05% = 0.05, total 0.15
            expect(fee).to.equal(ethers.utils.parseEther("0.15"));
            expect(net).to.equal(ethers.utils.parseEther("99.85"));
        });

        it("should return 0 fee if amount is 0", async () => {
            const [fee, net] = await controllerWrapper.quote(controller.address, 1, 0);
            expect(fee).to.equal(0);
            expect(net).to.equal(0);
        });
    });
    describe("rescueTokens", () => {
        let erc20: Contract;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            const ERC20 = await ethers.getContractFactory("XERC20Votes");
            erc20 = await ERC20.deploy(
                "Rescue Token",
                "RESCUE",
                [ownerSigner.address],
                [ethers.utils.parseEther("1000")],
                ownerSigner.address,
                ethers.constants.AddressZero,
                [],
                []
            );
            // Send tokens to wrapper
            await erc20.connect(ownerSigner).transfer(controllerWrapper.address, ethers.utils.parseEther("100"));
        });

        it("should allow admin to rescue tokens", async () => {
            const before = await erc20.balanceOf(user2Signer.address);
            await controllerWrapper.connect(ownerSigner).rescueTokens(erc20.address, user2Signer.address, ethers.utils.parseEther("50"));
            const after = await erc20.balanceOf(user2Signer.address);
            expect(after.sub(before)).to.equal(ethers.utils.parseEther("50"));
        });

        it("should revert if not admin", async () => {
            await expect(
                controllerWrapper.connect(user1Signer).rescueTokens(erc20.address, user2Signer.address, ethers.utils.parseEther("10"))
            ).to.be.revertedWith(`AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`);
        });

        it("should revert if to is zero address", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner).rescueTokens(erc20.address, ethers.constants.AddressZero, ethers.utils.parseEther("10"))
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ZeroAddress");
        });
    });

    describe("rescueETH", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            // Send ETH to wrapper
            await ownerSigner.sendTransaction({
                to: controllerWrapper.address,
                value: ethers.utils.parseEther("1.0"),
            });
        });

        it("should allow admin to rescue ETH", async () => {
            const before = await ethers.provider.getBalance(user2Signer.address);
            const tx = await controllerWrapper.connect(ownerSigner).rescueETH(user2Signer.address, ethers.utils.parseEther("0.5"));
            const receipt = await tx.wait();
            const after = await ethers.provider.getBalance(user2Signer.address);
            expect(after.sub(before)).to.equal(ethers.utils.parseEther("0.5"));
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user1Signer).rescueETH(user2Signer.address, ethers.utils.parseEther("0.1"))).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });

        it("should revert if to is zero address", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner).rescueETH(ethers.constants.AddressZero, ethers.utils.parseEther("0.1"))
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ZeroAddress");
        });
    });

    describe("pause", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
        });

        it("should allow admin to pause the contract", async () => {
            await controllerWrapper.connect(ownerSigner).pause();
            expect(await controllerWrapper.paused()).to.be.true;
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user1Signer).pause()).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
    });

    describe("unpause", () => {
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                100,
                [controller.address],
                [],
                []
            );
            await controllerWrapper.connect(ownerSigner).pause();
        });

        it("should allow admin to unpause the contract", async () => {
            await controllerWrapper.connect(ownerSigner).unpause();
            expect(await controllerWrapper.paused()).to.be.false;
        });

        it("should revert if not admin", async () => {
            await expect(controllerWrapper.connect(user1Signer).unpause()).to.be.revertedWith(
                `AccessControl: account ${user1Signer.address.toLowerCase()} is missing role ${defaultAdminRole}`
            );
        });
    });
    describe("transferTo (single adapter)", () => {
        let recipient: string;
        let bridgeAdapter: string;
        let bridgeOptions: string;
        let amount: any;
        let fee: any;
        let net: any;
        beforeEach(async () => {
            // Deploy wrapper with feeRate 1000 (1%)
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            recipient = user2Signer.address;
            bridgeAdapter = ethers.constants.AddressZero;
            bridgeOptions = "0x";
            amount = ethers.utils.parseEther("1000");
            // Approve wrapper to spend tokens
            await token.connect(ownerSigner).approve(controllerWrapper.address, amount);
            // Calculate fee and net
            [fee, net] = await controllerWrapper.quote(controller.address, 0, amount);
        });

        it("should transfer net amount to controller and collect fee to treasury", async () => {
            const treasuryBefore = await token.balanceOf(treasurySigner.address);
            const controllerBefore = await token.balanceOf(controller.address);
            // Call transferTo (overload signature)
            await controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address,bytes,bytes)"](
                {
                    controller: controller.address,
                    recipient,
                    amount,
                    unwrap: false,
                    destChainId: 0,
                },
                bridgeAdapter,
                bridgeOptions,
                "0x"
            );
            // Fee should be sent to treasury
            const treasuryAfter = await token.balanceOf(treasurySigner.address);
            expect(treasuryAfter.sub(treasuryBefore)).to.equal(fee);
            // Net should be sent to controller (mock just holds it)
            const controllerAfter = await token.balanceOf(controller.address);
            expect(controllerAfter.sub(controllerBefore)).to.equal(net);
        });

        it("should emit TransferSent and FeesCollected events", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address,bytes,bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    bridgeAdapter,
                    bridgeOptions,
                    "0x"
                )
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, false, false, amount, net, "0x")
                .and.to.emit(controllerWrapper, "FeesCollected")
                .withArgs(ownerSigner.address, token.address, controller.address, fee, treasurySigner.address);
        });

        it("should revert if controller is not whitelisted", async () => {
            // Remove controller from whitelist
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await token.connect(ownerSigner).approve(controllerWrapper.address, amount);
            await expect(
                controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address,bytes,bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    bridgeAdapter,
                    bridgeOptions,
                    "0x"
                )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });
    });
    describe("transferTo (multi-adapter)", () => {
        let recipient: string;
        let adapters: string[];
        let fees: any[];
        let options: string[];
        let amount: any;
        let fee: any;
        let net: any;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            recipient = user2Signer.address;
            adapters = [ethers.constants.AddressZero, ownerSigner.address];
            fees = [0, 0];
            options = ["0x", "0x"];
            amount = ethers.utils.parseEther("1000");
            await token.connect(ownerSigner).approve(controllerWrapper.address, amount);
            [fee, net] = await controllerWrapper.quote(controller.address, 0, amount);
        });

        it("should transfer net amount to controller and collect fee to treasury", async () => {
            const treasuryBefore = await token.balanceOf(treasurySigner.address);
            const controllerBefore = await token.balanceOf(controller.address);
            await controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address[],uint256[],bytes[],bytes)"](
                {
                    controller: controller.address,
                    recipient,
                    amount,
                    unwrap: false,
                    destChainId: 0,
                },
                adapters,
                fees,
                options,
                "0x"
            );
            const treasuryAfter = await token.balanceOf(treasurySigner.address);
            expect(treasuryAfter.sub(treasuryBefore)).to.equal(fee);
            const controllerAfter = await token.balanceOf(controller.address);
            expect(controllerAfter.sub(controllerBefore)).to.equal(net);
        });

        it("should emit TransferSent and FeesCollected events", async () => {
            await expect(
                controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address[],uint256[],bytes[],bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    adapters,
                    fees,
                    options,
                    "0x"
                )
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, false, true, amount, net, "0x")
                .and.to.emit(controllerWrapper, "FeesCollected")
                .withArgs(ownerSigner.address, token.address, controller.address, fee, treasurySigner.address);
        });

        it("should revert if controller is not whitelisted", async () => {
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await token.connect(ownerSigner).approve(controllerWrapper.address, amount);
            await expect(
                controllerWrapper.connect(ownerSigner)["transferTo((address,address,uint256,bool,uint256),address[],uint256[],bytes[],bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    adapters,
                    fees,
                    options,
                    "0x"
                )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });
    });

    describe("resendTransfer (single adapter)", () => {
        let transferId: string;
        let adapter: string;
        let options: string;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            transferId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            adapter = ethers.constants.AddressZero;
            options = "0x";
        });

        it("should revert if controller is not whitelisted", async () => {
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["resendTransfer(address,bytes32,address,bytes,bytes)"](controller.address, transferId, adapter, options, "0x")
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });

        it("should emit TransferSent event (resent, single)", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["resendTransfer(address,bytes32,address,bytes,bytes)"](controller.address, transferId, adapter, options, "0x")
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, true, false, 0, 0, "0x");
        });
    });

    describe("resendTransfer (multi-adapter)", () => {
        let transferId: string;
        let adapters: string[];
        let fees: any[];
        let options: string[];
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            transferId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            adapters = [ethers.constants.AddressZero, ownerSigner.address];
            fees = [0, 0];
            options = ["0x", "0x"];
        });

        it("should revert if controller is not whitelisted", async () => {
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["resendTransfer(address,bytes32,address[],uint256[],bytes[],bytes)"](
                        controller.address,
                        transferId,
                        adapters,
                        fees,
                        options,
                        "0x"
                    )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });

        it("should emit TransferSent event (resent, multi)", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["resendTransfer(address,bytes32,address[],uint256[],bytes[],bytes)"](
                        controller.address,
                        transferId,
                        adapters,
                        fees,
                        options,
                        "0x"
                    )
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, true, true, 0, 0, "0x");
        });
    });
    describe("transferToWPermit (single adapter)", () => {
        let recipient: string;
        let bridgeAdapter: string;
        let bridgeOptions: string;
        let amount: any;
        let fee: any;
        let net: any;
        let permit: any;
        let deadline: number;
        let owner: string;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            recipient = user2Signer.address;
            bridgeAdapter = ethers.constants.AddressZero;
            bridgeOptions = "0x";
            amount = ethers.utils.parseEther("1000");
            [fee, net] = await controllerWrapper.quote(controller.address, 0, amount);
            owner = ownerSigner.address;
            deadline = Math.floor(Date.now() / 1000) + 3600;

            // Build permit signature for ERC20Permit
            const nonce = await token.nonces(owner);
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const domain = {
                name: await token.name(),
                version: "1",
                chainId,
                verifyingContract: token.address,
            };
            const types = {
                Permit: [
                    {name: "owner", type: "address"},
                    {name: "spender", type: "address"},
                    {name: "value", type: "uint256"},
                    {name: "nonce", type: "uint256"},
                    {name: "deadline", type: "uint256"},
                ],
            };
            const values = {
                owner,
                spender: controllerWrapper.address,
                value: amount,
                nonce,
                deadline,
            };
            const signature = await ownerSigner._signTypedData(domain, types, values);
            const {v, r, s} = ethers.utils.splitSignature(signature);
            permit = {deadline, v, r, s};
        });

        it("should transfer net amount to controller and collect fee to treasury using permit", async () => {
            // No approval, only permit
            const treasuryBefore = await token.balanceOf(treasurySigner.address);
            const controllerBefore = await token.balanceOf(controller.address);
            await controllerWrapper
                .connect(ownerSigner)
                ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address,bytes,bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    permit,
                    bridgeAdapter,
                    bridgeOptions,
                    "0x"
                );
            const treasuryAfter = await token.balanceOf(treasurySigner.address);
            expect(treasuryAfter.sub(treasuryBefore)).to.equal(fee);
            const controllerAfter = await token.balanceOf(controller.address);
            expect(controllerAfter.sub(controllerBefore)).to.equal(net);
        });

        it("should emit TransferSent and FeesCollected events", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address,bytes,bytes)"](
                        {
                            controller: controller.address,
                            recipient,
                            amount,
                            unwrap: false,
                            destChainId: 0,
                        },
                        permit,
                        bridgeAdapter,
                        bridgeOptions,
                        "0x"
                    )
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, false, false, amount, net, "0x")
                .and.to.emit(controllerWrapper, "FeesCollected")
                .withArgs(ownerSigner.address, token.address, controller.address, fee, treasurySigner.address);
        });

        it("should revert if controller is not whitelisted", async () => {
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address,bytes,bytes)"](
                        {
                            controller: controller.address,
                            recipient,
                            amount,
                            unwrap: false,
                            destChainId: 0,
                        },
                        permit,
                        bridgeAdapter,
                        bridgeOptions,
                        "0x"
                    )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });
    });
    describe("transferToWPermit (multi-adapter)", () => {
        let recipient: string;
        let adapters: string[];
        let fees: any[];
        let options: string[];
        let amount: any;
        let fee: any;
        let net: any;
        let permit: any;
        let deadline: number;
        let owner: string;
        beforeEach(async () => {
            const ControllerWrapperFactory = await ethers.getContractFactory("ControllerWrapper");
            controllerWrapper = await ControllerWrapperFactory.deploy(
                [ownerSigner.address, user1Signer.address],
                treasurySigner.address,
                1000,
                [controller.address],
                [],
                []
            );
            recipient = user2Signer.address;
            adapters = [ethers.constants.AddressZero, ownerSigner.address];
            fees = [0, 0];
            options = ["0x", "0x"];
            amount = ethers.utils.parseEther("1000");
            [fee, net] = await controllerWrapper.quote(controller.address, 0, amount);
            owner = ownerSigner.address;
            deadline = Math.floor(Date.now() / 1000) + 3600;

            // Build permit signature for ERC20Permit
            const nonce = await token.nonces(owner);
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const domain = {
                name: await token.name(),
                version: "1",
                chainId,
                verifyingContract: token.address,
            };
            const types = {
                Permit: [
                    {name: "owner", type: "address"},
                    {name: "spender", type: "address"},
                    {name: "value", type: "uint256"},
                    {name: "nonce", type: "uint256"},
                    {name: "deadline", type: "uint256"},
                ],
            };
            const values = {
                owner,
                spender: controllerWrapper.address,
                value: amount,
                nonce,
                deadline,
            };
            const signature = await ownerSigner._signTypedData(domain, types, values);
            const {v, r, s} = ethers.utils.splitSignature(signature);
            permit = {deadline, v, r, s};
        });

        it("should transfer net amount to controller and collect fee to treasury using permit", async () => {
            // No approval, only permit
            const treasuryBefore = await token.balanceOf(treasurySigner.address);
            const controllerBefore = await token.balanceOf(controller.address);
            await controllerWrapper
                .connect(ownerSigner)
                ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address[],uint256[],bytes[],bytes)"](
                    {
                        controller: controller.address,
                        recipient,
                        amount,
                        unwrap: false,
                        destChainId: 0,
                    },
                    permit,
                    adapters,
                    fees,
                    options,
                    "0x"
                );
            const treasuryAfter = await token.balanceOf(treasurySigner.address);
            expect(treasuryAfter.sub(treasuryBefore)).to.equal(fee);
            const controllerAfter = await token.balanceOf(controller.address);
            expect(controllerAfter.sub(controllerBefore)).to.equal(net);
        });

        it("should emit TransferSent and FeesCollected events", async () => {
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address[],uint256[],bytes[],bytes)"](
                        {
                            controller: controller.address,
                            recipient,
                            amount,
                            unwrap: false,
                            destChainId: 0,
                        },
                        permit,
                        adapters,
                        fees,
                        options,
                        "0x"
                    )
            )
                .to.emit(controllerWrapper, "TransferSent")
                .withArgs(ownerSigner.address, controller.address, false, true, amount, net, "0x")
                .and.to.emit(controllerWrapper, "FeesCollected")
                .withArgs(ownerSigner.address, token.address, controller.address, fee, treasurySigner.address);
        });

        it("should revert if controller is not whitelisted", async () => {
            await controllerWrapper.connect(ownerSigner).setControllers([controller.address], [false]);
            await expect(
                controllerWrapper
                    .connect(ownerSigner)
                    ["transferToWPermit((address,address,uint256,bool,uint256),(uint256,uint8,bytes32,bytes32),address[],uint256[],bytes[],bytes)"](
                        {
                            controller: controller.address,
                            recipient,
                            amount,
                            unwrap: false,
                            destChainId: 0,
                        },
                        permit,
                        adapters,
                        fees,
                        options,
                        "0x"
                    )
            ).to.be.revertedWithCustomError(controllerWrapper, "Wrapper_ControllerNotWhitelisted");
        });
    });
});
