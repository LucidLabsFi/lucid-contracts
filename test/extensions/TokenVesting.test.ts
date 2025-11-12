import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("TokenVesting Tests", () => {
    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress;
    let user2Signer: SignerWithAddress;
    let vesting: Contract;
    let governanceToken: Contract;

    let startTime: number;
    const amountPerBeneficiary = ethers.utils.parseEther("5250000");
    const durationMultiplier = 30;
    const duration = 86400 * durationMultiplier; // 30 days

    beforeEach(async () => {
        [ownerSigner, user1Signer, user2Signer] = await ethers.getSigners();
        upgrades.silenceWarnings();

        // Deploy governance token
        const GovernanceToken = await ethers.getContractFactory("XERC20VotesUpgradeable");
        governanceToken = await upgrades.deployProxy(
            GovernanceToken,
            ["Test", "TST", [ownerSigner.address], [ethers.utils.parseEther("50000000")], ownerSigner.address, ownerSigner.address, [], []],
            {
                initializer: "initialize",
            }
        );
        await governanceToken.deployed();

        // Deploy vesting contract
        const VestingWallet = await ethers.getContractFactory("TokenVesting");
        vesting = await VestingWallet.connect(ownerSigner).deploy(governanceToken.address);

        startTime = (await ethers.provider.getBlock("latest")).timestamp + 60;
        await governanceToken.connect(ownerSigner).approve(vesting.address, amountPerBeneficiary.mul(2));
    });
    describe("constructor", () => {
        it("should set the token address", async () => {
            expect(await vesting.TOKEN()).to.be.equal(governanceToken.address);
        });
    });
    describe("createVestingSchedule", () => {
        beforeEach(async () => {});
        it("should revert if the arrays have different lengths", async () => {
            await expect(
                vesting.createVestingSchedule([{beneficiaries: [user1Signer.address], amounts: [], start: startTime, duration: duration}])
            ).to.be.revertedWithCustomError(vesting, "Vesting_InvalidParams");
        });
        it("should revert if no beneficiaries are passed", async () => {
            await expect(
                vesting.createVestingSchedule([{beneficiaries: [], amounts: [], start: startTime, duration: duration}])
            ).to.be.revertedWithCustomError(vesting, "Vesting_InvalidParams");
        });
        it("should revert if beneficiary is zero address", async () => {
            await expect(
                vesting.createVestingSchedule([
                    {beneficiaries: [ethers.constants.AddressZero], amounts: [ethers.utils.parseEther("10")], start: startTime, duration: duration},
                ])
            ).to.be.reverted;
        });
        it("should revert if amount is zero", async () => {
            await expect(
                vesting.createVestingSchedule([
                    {
                        beneficiaries: [user1Signer.address, user2Signer.address],
                        amounts: [0, ethers.utils.parseEther("10")],
                        start: startTime,
                        duration: duration,
                    },
                ])
            ).to.be.revertedWithCustomError(vesting, "Vesting_InvalidParams");
        });

        it("should transfer tokens to vesting contract", async () => {
            expect(
                await vesting.createVestingSchedule([
                    {
                        beneficiaries: [user1Signer.address, user2Signer.address],
                        amounts: [amountPerBeneficiary, amountPerBeneficiary],
                        start: startTime,
                        duration: duration,
                    },
                ])
            ).to.changeTokenBalance(governanceToken, vesting, amountPerBeneficiary.mul(2));
        });

        it("should create vesting schedule", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            const vestingSchedule = await vesting.vestingSchedules(user1Signer.address, 0);

            expect(vestingSchedule.beneficiary).to.equal(user1Signer.address);
            expect(vestingSchedule.start).to.equal(startTime);
            expect(vestingSchedule.duration).to.equal(duration);
            expect(vestingSchedule.amountTotal).to.equal(amountPerBeneficiary);
            expect(vestingSchedule.released).to.equal(0);
        });
        it("should create vesting schedule for multiple beneficiaries", async () => {
            await vesting.createVestingSchedule([
                {
                    beneficiaries: [user1Signer.address, ownerSigner.address],
                    amounts: [amountPerBeneficiary, amountPerBeneficiary],
                    start: startTime,
                    duration: duration,
                },
            ]);

            let vestingSchedule = await vesting.vestingSchedules(user1Signer.address, 0);

            expect(vestingSchedule.beneficiary).to.equal(user1Signer.address);
            expect(vestingSchedule.start).to.equal(startTime);
            expect(vestingSchedule.duration).to.equal(duration);
            expect(vestingSchedule.amountTotal).to.equal(amountPerBeneficiary);
            expect(vestingSchedule.released).to.equal(0);

            vestingSchedule = await vesting.vestingSchedules(ownerSigner.address, 0);

            expect(vestingSchedule.beneficiary).to.equal(ownerSigner.address);
            expect(vestingSchedule.start).to.equal(startTime);
            expect(vestingSchedule.duration).to.equal(duration);
            expect(vestingSchedule.amountTotal).to.equal(amountPerBeneficiary);
            expect(vestingSchedule.released).to.equal(0);
        });
        it("should revert if the max number of schedules for beneficiary is reached", async () => {
            const amount = ethers.utils.parseEther("200");
            const limit = await vesting.MAX_SCHED_BENF();
            for (let i = 0; i < limit; i++) {
                await vesting.createVestingSchedule([
                    {beneficiaries: [user1Signer.address], amounts: [amount], start: startTime, duration: duration},
                ]);
            }

            await expect(
                vesting.createVestingSchedule([{beneficiaries: [user1Signer.address], amounts: [amount], start: startTime, duration: duration}])
            ).to.be.revertedWithCustomError(vesting, "Vesting_MaxSchedulesReached");
        });
    });
    describe("vestedAmount", () => {
        it("should return 0 if vesting has not started", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(0);
        });

        it("should return 0 if duration is 0 and vesting has not started", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: 0},
            ]);

            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(0);
        });

        it("should return the total amount if duration is 0 and vesting has ended", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: 0},
            ]);

            await helpers.time.increase(61);

            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(amountPerBeneficiary);
        });

        it("should return the total amount if vesting has ended", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            await helpers.time.increase(duration + 61);

            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            const vestedAmount = await vesting.vestedAmount(schedule);

            expect(vestedAmount).to.equal(amountPerBeneficiary);
        });

        it("should return the correct amount if vesting is in progress", async () => {
            startTime = (await ethers.provider.getBlock("latest")).timestamp + 60;
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);
            await helpers.time.increase(59); // We set this to 59 seconds because the next "send" will increase the block timestamp by 1 second

            // durationMultiplier is 30 days, so after 1 day, 1/30 of the total amount should be vested
            for (let i = 0; i < durationMultiplier; i++) {
                await helpers.time.increase(60 * 60 * 24);
                const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

                const vestedAmount = await vesting.vestedAmount(schedule);
                expect(vestedAmount).to.equal(amountPerBeneficiary.div(durationMultiplier).mul(i + 1));
            }
        });
    });
    describe("releasableAmount", () => {
        it("should correctly return the releasable amount", async () => {
            startTime = (await ethers.provider.getBlock("latest")).timestamp + 60;

            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            await helpers.time.increase(59); // We set this to 59 seconds because the next "send" will increase the block timestamp by 1 second
            await helpers.time.increase(60 * 60 * 24);

            const releasableAmountBefore = await vesting.releasableAmount(await vesting.vestingSchedules(user1Signer.address, 0));
            await vesting.release(user1Signer.address);

            // After releasing the releasable amount, increase the time again so that the same
            await helpers.time.increase(duration);

            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);
            expect(await vesting.releasableAmount(schedule)).to.be.lte(schedule.amountTotal.sub(releasableAmountBefore));
        });
    });
    describe("release", () => {
        it("should revert it beneficiary has no vesting schedules", async () => {
            await expect(vesting.release(user1Signer.address)).to.be.revertedWithCustomError(vesting, "Vesting_NoVestingSchedules");
        });

        it("should not send tokens if there are no tokens to release", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            const balanceBefore = await governanceToken.balanceOf(user1Signer.address);

            await vesting.release(user1Signer.address);

            const balanceAfter = await governanceToken.balanceOf(user1Signer.address);

            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("should correctly release tokens", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            await helpers.time.increase(60 * 60 * 24 * durationMultiplier + 61);

            const releasableAmount = await vesting.releasableAmount(await vesting.vestingSchedules(user1Signer.address, 0));

            await expect(vesting.release(user1Signer.address)).to.changeTokenBalance(governanceToken, user1Signer, releasableAmount);
        });
    });
    describe("getReleaseableAmount", () => {
        it("should return 0 if beneficiary has no vesting schedules", async () => {
            const releasableAmount = await vesting.getReleaseableAmount(user1Signer.address);

            expect(releasableAmount).to.equal(0);
        });

        it("should correctly return the releasable amount", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            await helpers.time.increase(60 * 60 * 24 + 58);

            const releasableAmount = await vesting.getReleaseableAmount(user1Signer.address);

            expect(releasableAmount).to.equal(amountPerBeneficiary.div(durationMultiplier));
        });
    });
    describe("getVestingAmount", () => {
        it("should return 0 if beneficiary has no vesting schedules", async () => {
            const releasableAmount = await vesting.getReleaseableAmount(user1Signer.address);

            expect(releasableAmount).to.equal(0);
        });

        it("should correctly return the vesting amount", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            //await helpers.time.increase(60 * 60 * 24 + 58);

            const vestingAmount = await vesting.getVestingAmount(user1Signer.address);
            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            expect(vestingAmount).to.equal(schedule.amountTotal);
        });
        it("should correctly return the vesting amount minus the received amount already", async () => {
            await vesting.createVestingSchedule([
                {beneficiaries: [user1Signer.address], amounts: [amountPerBeneficiary], start: startTime, duration: duration},
            ]);

            await helpers.time.increase(60 * 60 * 24 + 58);
            await vesting.release(user1Signer.address);

            const balanceAfter = await governanceToken.balanceOf(user1Signer.address);

            const vestingAmount = await vesting.getVestingAmount(user1Signer.address);
            const schedule = await vesting.vestingSchedules(user1Signer.address, 0);

            expect(vestingAmount).to.equal(schedule.amountTotal.sub(balanceAfter));
        });
    });
});
