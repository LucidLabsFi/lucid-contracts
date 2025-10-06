// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {Ownable2StepInit, OwnableInit} from "../../../utils/access/Ownable2StepInit.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {V3SpokePoolInterface} from "./interfaces/V3SpokePoolInterface.sol";

contract AcrossV4Wrapper is Ownable2StepInit, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ===== Events =====
    event TransferSent(
        address indexed sender,
        address indexed inputToken,
        uint256 indexed destChainId,
        address outputToken,
        address recipient,
        bool usedNative,
        uint256 grossInputAmount,
        uint256 netInputAmount,
        uint256 outputAmount,
        bytes emittedMessage
    );
    event FeeTaken(address indexed token, address indexed treasury, uint256 amount);
    event FeeRateSet(uint256 oldRate, uint256 newRate);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);

    // ===== Errors =====
    error Wrapper_InvalidFeeRate();
    error Wrapper_TreasuryZeroAddress();
    error Wrapper_SpokePoolZeroAddress();
    error Wrapper_TransferFailed();
    error Wrapper_MsgValueNotZero();
    error Wrapper_FeeOnTransferToken();
    error Wrapper_SpokeCallFailed();
    error Wrapper_MsgValueInputAmountMismatch();
    error Wrapper_ZeroAddress();

    struct DepositInput {
        address depositor;
        address recipient;
        address inputToken;
        address outputToken;
        uint256 inputAmount; // gross amount the user provides
        uint256 outputAmount; // corresponds to NET inputAmount passed onward
        uint256 destinationChainId;
        address exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityParameter;
        bytes message; // passed as is to Across
        bytes emittedMessage; // emitted as is from this contract
        bool useNative; // true only when inputToken is wrapped-native and msg.value == inputAmount
    }

    uint256 public constant RATE_DENOMINATOR = 100_000; // 100.00%
    uint256 public constant MAX_FEE_RATE = 5_000; // 5.00%

    address public immutable SPOKE_POOL;
    address payable public treasury;

    uint256 public feeRate; // 0..100_000

    constructor(address _spokePool, address _owner, address payable _treasury, uint256 _feeRate) OwnableInit(_owner) {
        if (_spokePool == address(0)) revert Wrapper_SpokePoolZeroAddress();
        if (_treasury == address(0) && _feeRate > 0) revert Wrapper_TreasuryZeroAddress();
        if (_feeRate > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();

        SPOKE_POOL = _spokePool;
        treasury = _treasury;
        feeRate = _feeRate;
        emit TreasurySet(address(0), _treasury);
        emit FeeRateSet(0, _feeRate);
    }

    // ---------------- Admin ----------------

    function setTreasury(address payable newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert Wrapper_TreasuryZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setFeeRate(uint256 newRate) external onlyOwner {
        if (newRate > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
        if (newRate > 0 && treasury == address(0)) revert Wrapper_TreasuryZeroAddress();
        emit FeeRateSet(feeRate, newRate);
        feeRate = newRate;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert Wrapper_TransferFailed();
    }

    // ---------------- Entrypoint ----------------

    function depositV3(DepositInput calldata d) external payable nonReentrant whenNotPaused {
        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);

        if (d.useNative) {
            _depositNativeWithFee(d, fee, net);
        } else {
            _depositERC20WithFee(d, fee, net);
        }
    }

    function quote(uint256 amount) external view returns (uint256 fee, uint256 net) {
        return _computeFeeAndNet(amount);
    }

    // ---------------- Internal helpers ----------------

    function _depositNativeWithFee(DepositInput calldata d, uint256 fee, uint256 net) internal {
        if (msg.value != d.inputAmount) revert Wrapper_MsgValueInputAmountMismatch();

        // Send fee to treasury
        if (fee > 0) {
            (bool success, ) = treasury.call{value: fee}("");
            if (!success) revert Wrapper_TransferFailed();
        }

        // Forward NET ETH and NET inputAmount to SpokePool
        _callSpokeWithLowStack(d, net, net);

        emit TransferSent(
            msg.sender,
            d.inputToken,
            d.destinationChainId,
            d.outputToken,
            d.recipient,
            true,
            d.inputAmount,
            net,
            d.outputAmount,
            d.emittedMessage
        );
    }

    function _depositERC20WithFee(DepositInput calldata d, uint256 fee, uint256 net) internal {
        if (msg.value != 0) revert Wrapper_MsgValueNotZero();
        IERC20 token = IERC20(d.inputToken);

        // Pull gross, disallow fee-on-transfer by checking balance delta
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), d.inputAmount);
        uint256 received = token.balanceOf(address(this)) - balBefore;
        if (received != d.inputAmount) revert Wrapper_FeeOnTransferToken();

        // Send fee to treasury
        if (fee > 0) token.safeTransfer(treasury, fee);

        // Approve only NET, call SpokePool, then zero allowance
        token.safeApprove(SPOKE_POOL, 0);
        token.safeApprove(SPOKE_POOL, net);

        _callSpokeWithLowStack(d, net, 0);

        token.safeApprove(SPOKE_POOL, 0);

        emit TransferSent(
            msg.sender,
            d.inputToken,
            d.destinationChainId,
            d.outputToken,
            d.recipient,
            false,
            d.inputAmount,
            net,
            d.outputAmount,
            d.emittedMessage
        );
    }

    /// @dev Build calldata and do a low-level call. This avoids stack-too-deep at the callsite.
    /// @param netInputAmount The amount passed to SpokePool as inputAmount (after fee).
    /// @param value The ETH value sent alongside (0 or netInputAmount for native).
    function _callSpokeWithLowStack(DepositInput calldata d, uint256 netInputAmount, uint256 value) internal {
        bytes memory data = abi.encodeWithSelector(
            V3SpokePoolInterface.depositV3.selector,
            d.depositor,
            d.recipient,
            d.inputToken,
            d.outputToken,
            netInputAmount, // pass NET amount
            d.outputAmount,
            d.destinationChainId,
            d.exclusiveRelayer,
            d.quoteTimestamp,
            d.fillDeadline,
            d.exclusivityParameter,
            d.message
        );

        (bool success, ) = payable(SPOKE_POOL).call{value: value}(data);
        if (!success) revert Wrapper_SpokeCallFailed();
    }

    function _computeFeeAndNet(uint256 gross) internal view returns (uint256 fee, uint256 net) {
        if (feeRate == 0 || gross == 0) return (0, gross);
        fee = (gross * feeRate) / RATE_DENOMINATOR;
        net = gross - fee;
    }

    receive() external payable {}
}
