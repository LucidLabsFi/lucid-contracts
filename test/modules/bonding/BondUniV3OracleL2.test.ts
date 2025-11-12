import {expect} from "chai";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("BondUniV3OracleL2 Tests", () => {
    const vestingLength = 86400; // 1 day. Since market is fixed term, vesting is vesting length in seconds
    const bondDuration = 518400; // 6 days in seconds

    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress; // collect protocol fees

    let authority: Contract;
    let aggregator: Contract;
    let teller: Contract;
    let auctioner: Contract;
    let payoutToken: Contract;
    let quoteToken: Contract;
    let oracle: Contract;
    let poolOne: Contract;
    let sequencerFeed: Contract;
    let vesting: Contract;

    beforeEach(async () => {
        [ownerSigner, user1Signer] = await ethers.getSigners();

        // Deploy Vesting
        const Vesting = await ethers.getContractFactory("BondVesting");
        vesting = await Vesting.deploy();

        // Deploy Authority
        const Authority = await ethers.getContractFactory("BondAuthority");
        authority = await Authority.deploy(ownerSigner.address, ethers.constants.AddressZero);

        // Deploy Aggregator
        const Aggregator = await ethers.getContractFactory("BondAggregator");
        aggregator = await Aggregator.deploy(ownerSigner.address, authority.address);

        // Create Payout token
        const PayoutToken = await ethers.getContractFactory("SimpleToken");
        payoutToken = await PayoutToken.connect(ownerSigner).deploy();

        // Create Payout token
        quoteToken = await PayoutToken.connect(user1Signer).deploy();
    });
    describe("Create fixed-term oracle dutch auction market using a Uniswap V3 Pair as a price feed", () => {
        beforeEach(async () => {
            // Deploy Mock Price Feed 1 - Payout/Quote token - Uniswap V3 Pair
            const PoolOne = await ethers.getContractFactory("MockUniV3Pair");
            poolOne = await PoolOne.deploy();
            // Set the price feed
            await poolOne.setToken0(quoteToken.address);
            await poolOne.setToken1(payoutToken.address);
            await poolOne.setTickCumulatives([-1000415909, -1000000000]);
            await poolOne.setFirstObsTimestamp(Math.floor(Date.now() / 1000) - 3600);

            // Deploy Teller
            const Teller = await ethers.getContractFactory("BondFixedTermTeller");
            teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority

            // Deploy Auctioner
            const Auctioner = await ethers.getContractFactory("BondFixedTermOSDA");
            auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

            // Deploy Mock Sequencer Uptime Feed
            const SequencerFeed = await ethers.getContractFactory("SequencerUptimeFeedMock");
            sequencerFeed = await SequencerFeed.deploy();

            // Configure Sequencer Feed - current timestamp
            await sequencerFeed.setStartedAt(Math.floor(Date.now() / 1000 - 3600));
            await sequencerFeed.setAnswer(0);

            // Deploy Oracle
            const Oracle = await ethers.getContractFactory("BondUniV3OracleL2");
            oracle = await Oracle.deploy(aggregator.address, [auctioner.address], sequencerFeed.address, ownerSigner.address); // We need the addresses of all the auctioners to register them in the oracle

            // Register the auctioner in the aggregator
            await aggregator.registerAuctioneer(auctioner.address);

            // Set price in Oracle - admins
            // Check documentation in BondUniV3Oracle.sol on how to configure price feeds
            // Scenario 1 - Uniswap V3 Pair
            const encodedOracleParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, uint32, uint8)"],
                [[poolOne.address, ethers.constants.AddressZero, "60", "18"]]
            );

            // call setPair in oracle - quote, payout, supported, oracle params
            await oracle.setPair(quoteToken.address, payoutToken.address, true, encodedOracleParams);

            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        payoutToken.address,
                        quoteToken.address,
                        ethers.constants.AddressZero,
                        oracle.address,
                        "4750",
                        "19750",
                        "9750",
                        false,
                        ethers.utils.parseEther("10000"),
                        "86400",
                        vestingLength,
                        "0",
                        bondDuration,
                        "0",
                        "0",
                    ],
                ]
            );

            // Call create market
            await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await payoutToken.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));
        });
        it("should purchase a bond if sequencer is not down", async () => {
            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("400"));
            // Purchase bond
            await expect(
                teller
                    .connect(user1Signer)
                    .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("400"), ethers.utils.parseEther("80"))
            ).to.not.reverted;
        });
        it("should revert if sequencer uptime feed returns status = 1", async () => {
            await sequencerFeed.setAnswer(1);
            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("400"));
            // Purchase bond
            await expect(
                teller
                    .connect(user1Signer)
                    .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("400"), ethers.utils.parseEther("80"))
            ).to.be.revertedWithCustomError(oracle, "BondOracle_SequencerDown");
        });
        it("should revert if current timestamp is not past catchup period after restart", async () => {
            await sequencerFeed.setStartedAt(Math.floor(Date.now() / 1000));
            await quoteToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("400"));
            // Purchase bond
            await expect(
                teller
                    .connect(user1Signer)
                    .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("400"), ethers.utils.parseEther("80"))
            ).to.be.revertedWithCustomError(oracle, "BondOracle_SequencerDown");
        });
    });
});
