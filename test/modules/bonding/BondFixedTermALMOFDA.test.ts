import {expect} from "chai";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract} from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("BondFixedTerm ALM OFDA Tests", () => {
    const vestingLength = 86400; // 1 day. Since market is fixed term, vesting is vesting length in seconds
    const bondDuration = 518400; // 6 days in seconds

    const marketDiscount = 1000; // 10% discount in basis points
    const maxDiscount = 50000; // 50% discount in basis points

    let ownerSigner: SignerWithAddress;
    let user1Signer: SignerWithAddress; // collect protocol fees

    let authority: Contract;
    let aggregator: Contract;
    let teller: Contract;
    let auctioner: Contract;
    let payoutToken: Contract;
    let oracle: Contract;
    let stablecoin: Contract;
    let almToken: Contract;
    let mockTwapOracle: Contract;
    let vesting: Contract;

    const twapExpiration = 120; // 2 minutes

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
        const Stablecoin = await ethers.getContractFactory("SimpleToken");
        stablecoin = await Stablecoin.connect(ownerSigner).deploy();
        // Create Mock TWAP Oracle
        const MockTwapOracle = await ethers.getContractFactory("MockTWAPOracle");
        mockTwapOracle = await MockTwapOracle.deploy(ownerSigner.address, ownerSigner.address, twapExpiration);

        // 1M total supply of LP tokens
        // 1M stablecoins (token0) in the pool - 1 stable = 1$
        // 2M GOV (token1) in the pool - 1 GOV = 2$
        // LP token price = $5
        // token0 price = $1
        // token1 price = $2

        // Create Mock ALM Pool token
        const MockALMPool = await ethers.getContractFactory("MockALMPool");
        almToken = await MockALMPool.connect(user1Signer).deploy(); // 1M lp tokens are minted
        // Set the price feed
        await almToken.setToken0(stablecoin.address);
        await almToken.setToken1(payoutToken.address);
        await almToken.setToken0Amount(ethers.utils.parseEther("1000000"));
        await almToken.setToken1Amount(ethers.utils.parseEther("2000000"));
        // console.log("balance of alm tokens: ", await almToken.totalSupply());

        // Configure TWAP Oracle Mock
        // base token - quote token.
        const currentTimestamp = await helpers.time.latest();
        // await mockTwapOracle.setPrice(stablecoin.address, payoutToken.address, ethers.utils.parseEther("1"), currentTimestamp);
        await mockTwapOracle.setPrice(payoutToken.address, stablecoin.address, ethers.utils.parseEther("2"), currentTimestamp);

        // console.log("price in twap oracle stablecoin/payout", await mockTwapOracle.getPrice(stablecoin.address, payoutToken.address));
        // console.log("price in twap oracle payout/stablecoin", await mockTwapOracle.getPrice(payoutToken.address, stablecoin.address));

        // Deploy Teller
        const Teller = await ethers.getContractFactory("BondFixedTermTeller");
        teller = await Teller.deploy(user1Signer.address, aggregator.address, ownerSigner.address, authority.address, vesting.address); // fees collector, aggregator, owner, authority, vesting contract

        // Deploy Auctioner
        const Auctioner = await ethers.getContractFactory("BondFixedTermOFDA");
        auctioner = await Auctioner.deploy(teller.address, aggregator.address, ownerSigner.address, authority.address); // teller, aggregator, owner, authority

        // Deploy Oracle
        const Oracle = await ethers.getContractFactory("BondALMOracle");
        oracle = await Oracle.deploy(aggregator.address, [auctioner.address], mockTwapOracle.address, ownerSigner.address); // We need the addresses of all the auctioners to register them in the oracle

        // Register the auctioner in the aggregator
        await aggregator.registerAuctioneer(auctioner.address);
    });
    describe("Create fixed-term oracle fixed discount market", () => {
        beforeEach(async () => {
            // Set price in Oracle - admins
            // In BondALMOracle, we pass an empty bytes array as the encoded params. We assume quote token is the ALM Pool
            // call setPair in oracle - almToken, payout, supported, oracle params
            await oracle.setPair(almToken.address, stablecoin.address, true, ethers.utils.hexlify([]));
            //
            // Create market on Auctioner
            //
            // Encode function params
            const encodedParams = ethers.utils.defaultAbiCoder.encode(
                ["tuple(address, address, address, address, uint48, uint48, bool, uint256, uint48, uint48, uint48, uint48, uint48)"],
                [
                    [
                        stablecoin.address, //payout token for the bond
                        almToken.address, // quote token for the bond
                        ethers.constants.AddressZero,
                        oracle.address,
                        marketDiscount, // 10% discount
                        maxDiscount, // max 50% discount from current
                        false, // capacity in payout tokens
                        ethers.utils.parseEther("10000"),
                        "360000",
                        vestingLength,
                        "0",
                        bondDuration,
                        "0",
                    ],
                ]
            );
            // Call create market
            await auctioner.createMarket(encodedParams);
            // Approve payout tokens from owner to teller contract to be able to transfer on new purchases
            await stablecoin.connect(ownerSigner).approve(teller.address, ethers.utils.parseEther("100000"));
        });
        it("should revert if the twap has expired", async () => {
            // Jump in time in hardhat
            await helpers.time.increase(120); // 2 mininutes
            // expect to revert
            await expect(oracle["currentPrice(address,address)"](almToken.address, stablecoin.address)).to.be.revertedWithCustomError(
                mockTwapOracle,
                "TWAPOracle_PriceExpired"
            );
        });
        it("should return the inverse price (currentPricePerLpToken)", async () => {
            const oraclePrice = await oracle.currentPricePerLpToken(almToken.address, stablecoin.address);

            const lpTotalSupply = await almToken.totalSupply();
            const r0 = await almToken.totalAmount0();
            const r1 = await almToken.totalAmount1();

            const p0 = ethers.utils.parseEther("1"); // token 0 is the payout token of the bond.
            const p1 = await mockTwapOracle.getPrice(payoutToken.address, stablecoin.address);

            const totalReserves = r0
                .mul(p0)
                .div(ethers.utils.parseEther("1"))
                .add(r1.mul(p1).div(ethers.utils.parseEther("1")));
            const calculatedPrice = totalReserves.mul(ethers.utils.parseEther("1")).div(lpTotalSupply);
            expect(oraclePrice).to.be.equal(calculatedPrice);
        });
        it("should create a fixed-term market, transfering the payout tokens ", async () => {
            const oraclePrice = await oracle["currentPrice(address,address)"](almToken.address, stablecoin.address);
            // console.log("ALM oracle price from oracle:", oraclePrice);

            //
            // Purchase bond
            //
            // Approve tokens
            await almToken.connect(user1Signer).approve(teller.address, ethers.utils.parseEther("400"));
            const user1PayoutTokenBalanceBefore = await stablecoin.balanceOf(user1Signer.address);
            // Purchase bond
            const tx = await teller
                .connect(user1Signer)
                .purchase(user1Signer.address, ethers.constants.AddressZero, 0, ethers.utils.parseEther("400"), ethers.utils.parseEther("90"));
            // Get expiry and token id
            let receipt = await tx.wait();
            // Get tokenId from event during purchase
            let event = receipt.events?.filter((x: any) => {
                return x.event == "TransferSingle";
            });
            const tokenId = event[0].args["id"];

            //
            // Claim bond
            //
            // Jump in time in hardhat
            await helpers.time.increase(bondDuration * 2);

            // Attach bond token - teller contract - and call balance of
            const bondTokenContract = await ethers.getContractAt("BondFixedTermTeller", teller.address);
            const balance = await bondTokenContract.balanceOf(user1Signer.address, tokenId);
            // Claim bond
            await teller.connect(user1Signer).redeem(tokenId, balance);
            // console.log("Bond claimed!");
            const user1PayoutTokenBalanceAfter = await stablecoin.balanceOf(user1Signer.address);
            expect(await stablecoin.balanceOf(user1Signer.address)).to.be.equal(balance); //Payout tokens should be transfered to the user 1:1

            // Calculate the discounted price dynamically
            const priceWithDiscount = oraclePrice.mul(ethers.BigNumber.from(100000 - marketDiscount)).div(ethers.BigNumber.from(100000));
            // console.log("Price with discount: ", priceWithDiscount);
            // Calculate the expected payout
            const expectedPayout = ethers.utils.parseEther("400").mul(ethers.utils.parseEther("1")).div(priceWithDiscount);
            // console.log("Expected payout: ", ethers.utils.formatEther(expectedPayout));
            expect(user1PayoutTokenBalanceAfter.sub(user1PayoutTokenBalanceBefore)).to.be.equal(expectedPayout);
        });
    });
});
