// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";

contract MockUniV3Pair is IUniswapV3Pool {
    uint160 internal _sqrtPrice;
    address internal _token0;
    address internal _token1;
    uint32 internal _firstObsTimestamp;
    int56[] internal _tickCumulatives;
    uint160[] internal _secondsPerLiquidityCumulativeX128;

    constructor() {
        _sqrtPrice = 0;
        _token0 = address(0);
        _token1 = address(0);
        _firstObsTimestamp = 0;
        _tickCumulatives = new int56[](0);
        _secondsPerLiquidityCumulativeX128 = new uint160[](2);
        _secondsPerLiquidityCumulativeX128[0] = 0;
        _secondsPerLiquidityCumulativeX128[1] = 1;
    }

    // Setters

    function setSqrtPrice(uint160 sqrtPrice_) public {
        _sqrtPrice = sqrtPrice_;
    }

    function setToken0(address token_) public {
        _token0 = token_;
    }

    function setToken1(address token_) public {
        _token1 = token_;
    }

    function setTickCumulatives(int56[] memory observations_) public {
        _tickCumulatives = observations_;
    }

    function setFirstObsTimestamp(uint32 timestamp_) public {
        _firstObsTimestamp = timestamp_;
    }

    // Standard functions

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (_sqrtPrice, 0, 1, 1, 1, 0, true);
    }

    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) {
        return (_tickCumulatives, _secondsPerLiquidityCumulativeX128);
    }

    function token0() external view returns (address) {
        return _token0;
    }

    function token1() external view returns (address) {
        return _token1;
    }

    // Not implemented

    function fee() external view returns (uint24) {}

    function tickSpacing() external view returns (int24) {}

    function maxLiquidityPerTick() external view returns (uint128) {}

    function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external {}

    function collectProtocol(
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1) {}

    function initialize(uint160 sqrtPriceX96) external {}

    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1) {}

    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1) {}

    function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1) {}

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {}

    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external {}

    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external {}

    function snapshotCumulativesInside(
        int24 tickLower,
        int24 tickUpper
    ) external view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside) {}

    function factory() external view returns (address) {}

    function feeGrowthGlobal0X128() external view returns (uint256) {}

    function feeGrowthGlobal1X128() external view returns (uint256) {}

    function protocolFees() external view returns (uint128 token0, uint128 token1) {}

    function liquidity() external view returns (uint128) {}

    function ticks(
        int24 tick
    )
        external
        view
        returns (
            uint128 liquidityGross,
            int128 liquidityNet,
            uint256 feeGrowthOutside0X128,
            uint256 feeGrowthOutside1X128,
            int56 tickCumulativeOutside,
            uint160 secondsPerLiquidityOutsideX128,
            uint32 secondsOutside,
            bool initialized
        )
    {}

    function tickBitmap(int16 wordPosition) external view returns (uint256) {}

    function positions(
        bytes32 key
    )
        external
        view
        returns (uint128 _liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)
    {}

    function observations(
        uint256 index
    ) external view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized) {
        return (_firstObsTimestamp, 0, 0, true);
    }
}
