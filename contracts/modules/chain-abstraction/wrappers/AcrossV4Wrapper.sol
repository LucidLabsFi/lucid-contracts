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
        bytes32 indexed inputToken,
        uint256 indexed destChainId,
        bytes32 outputToken,
        bytes32 recipient,
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

    struct DepositInputBytes32 {
        bytes32 depositor;
        bytes32 recipient;
        bytes32 inputToken;
        bytes32 outputToken;
        uint256 inputAmount; // gross amount the user provides
        uint256 outputAmount; // corresponds to NET inputAmount passed onward
        uint256 destinationChainId;
        bytes32 exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityParameter;
        bytes message; // passed as is to Across
        bytes emittedMessage; // emitted as is from this contract
        bool useNative; // true only when inputToken is wrapped-native and msg.value == inputAmount
    }

    struct DepositInputBytes32Now {
        bytes32 depositor;
        bytes32 recipient;
        bytes32 inputToken;
        bytes32 outputToken;
        uint256 inputAmount; // gross amount the user provides
        uint256 outputAmount; // corresponds to NET inputAmount passed onward
        uint256 destinationChainId;
        bytes32 exclusiveRelayer;
        uint32 fillDeadlineOffset;
        uint32 exclusivityDeadline;
        bytes message; // passed as is to Across
        bytes emittedMessage; // emitted as is from this contract
        bool useNative; // true only when inputToken is wrapped-native and msg.value == inputAmount
    }

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

    /**
     * @param _spokePool The Across V4 SpokePool address
     * @param _owner The owner address
     * @param _treasury The treasury address
     * @param _feeRate The fee rate
     */
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

    // ===== Admin =====

    /**
     * @notice Set a new treasury address
     * @param newTreasury The new treasury address
     */
    function setTreasury(address payable newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert Wrapper_TreasuryZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    /**
     * @notice Set a new fee rate
     * @param newRate The new fee rate
     */
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

    /**
     * @notice Recover tokens sent to the contract
     * @param token The address of the token to recover.
     * @param to The address to send the recovered tokens to.
     * @param amount The amount of tokens to recover.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Recover ETH sent to the contract
     * @param to The address to send the recovered ETH to.
     * @param amount The amount of ETH to recover.
     */
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert Wrapper_TransferFailed();
    }

    // ===== Entrypoint =====

    /**
     * @notice Deposit assets to be transferred via Across V4 SpokePool (bytes32-based interface)
     * An ERC20 approval of the amount must be given to this contract prior to calling this function if not using native.
     * @param d The deposit input parameters with bytes32 types
     */
    function deposit(DepositInputBytes32 calldata d) external payable nonReentrant whenNotPaused {
        if (d.useNative) {
            _depositNativeBytes32(d);
        } else {
            _depositERC20Bytes32(d);
        }
    }

    /**
     * @notice Deposit assets to be transferred via Across V4 SpokePool using depositNow (bytes32-based with fillDeadlineOffset)
     * An ERC20 approval of the amount must be given to this contract prior to calling this function if not using native.
     * @param d The deposit input parameters with bytes32 types and fillDeadlineOffset
     */
    function depositNow(DepositInputBytes32Now calldata d) external payable nonReentrant whenNotPaused {
        if (d.useNative) {
            _depositNativeBytes32Now(d);
        } else {
            _depositERC20Bytes32Now(d);
        }
    }

    /**
     * @notice Deposit assets to be transferred via Across V4 SpokePool (legacy address-based interface)
     * An ERC20 approval of the amount must be given to this contract prior to calling this function if not using native.
     * @param d The deposit input parameters
     */
    function depositV3(DepositInput calldata d) external payable nonReentrant whenNotPaused {
        if (d.useNative) {
            _depositNative(d);
        } else {
            _depositERC20(d);
        }
    }

    /**
     * @notice Quote the fee and net amount for a given gross amount
     * @param amount The gross amount
     * @return fee The fee amount
     * @return net The net amount after fee
     */
    function quote(uint256 amount) external view returns (uint256 fee, uint256 net) {
        return _computeFeeAndNet(amount);
    }

    // ===== Internal helpers =====

    function _depositNativeBytes32(DepositInputBytes32 calldata d) internal {
        if (msg.value != d.inputAmount) revert Wrapper_MsgValueInputAmountMismatch();

        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);
        _sendNativeFeeToTreasury(fee);

        bytes memory data = _encodeDepositCalldata(d, net);
        _callSpokePool(data, net);

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

    function _depositERC20Bytes32(DepositInputBytes32 calldata d) internal {
        if (msg.value != 0) revert Wrapper_MsgValueNotZero();
        IERC20 token = IERC20(_bytes32ToAddress(d.inputToken));
        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);

        _pullTokenAndTakeFee(token, d.inputAmount, fee);

        bytes memory data = _encodeDepositCalldata(d, net);
        _approveCallAndReset(token, net, data);

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

    function _depositNativeBytes32Now(DepositInputBytes32Now calldata d) internal {
        if (msg.value != d.inputAmount) revert Wrapper_MsgValueInputAmountMismatch();

        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);
        _sendNativeFeeToTreasury(fee);

        bytes memory data = _encodeDepositNowCalldata(d, net);
        _callSpokePool(data, net);

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

    function _depositERC20Bytes32Now(DepositInputBytes32Now calldata d) internal {
        if (msg.value != 0) revert Wrapper_MsgValueNotZero();
        IERC20 token = IERC20(_bytes32ToAddress(d.inputToken));
        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);

        _pullTokenAndTakeFee(token, d.inputAmount, fee);

        bytes memory data = _encodeDepositNowCalldata(d, net);
        _approveCallAndReset(token, net, data);

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

    function _depositNative(DepositInput calldata d) internal {
        if (msg.value != d.inputAmount) revert Wrapper_MsgValueInputAmountMismatch();

        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);
        _sendNativeFeeToTreasury(fee);

        bytes memory data = _encodeDepositCalldataV3(d, net);
        _callSpokePool(data, net);

        emit TransferSent(
            msg.sender,
            _addressToBytes32(d.inputToken),
            d.destinationChainId,
            _addressToBytes32(d.outputToken),
            _addressToBytes32(d.recipient),
            true,
            d.inputAmount,
            net,
            d.outputAmount,
            d.emittedMessage
        );
    }

    function _depositERC20(DepositInput calldata d) internal {
        if (msg.value != 0) revert Wrapper_MsgValueNotZero();
        IERC20 token = IERC20(d.inputToken);
        (uint256 fee, uint256 net) = _computeFeeAndNet(d.inputAmount);

        _pullTokenAndTakeFee(token, d.inputAmount, fee);

        bytes memory data = _encodeDepositCalldataV3(d, net);
        _approveCallAndReset(token, net, data);

        emit TransferSent(
            msg.sender,
            _addressToBytes32(d.inputToken),
            d.destinationChainId,
            _addressToBytes32(d.outputToken),
            _addressToBytes32(d.recipient),
            false,
            d.inputAmount,
            net,
            d.outputAmount,
            d.emittedMessage
        );
    }

    /// @dev Send native ETH fee to treasury.
    function _sendNativeFeeToTreasury(uint256 fee) internal {
        if (fee > 0) {
            (bool success, ) = treasury.call{value: fee}("");
            if (!success) revert Wrapper_TransferFailed();
            emit FeeTaken(address(0), treasury, fee);
        }
    }

    /// @dev Pull tokens from sender and send fee to treasury
    function _pullTokenAndTakeFee(IERC20 token, uint256 amount, uint256 fee) internal {
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balBefore;
        if (received != amount) revert Wrapper_FeeOnTransferToken();

        if (fee > 0) {
            token.safeTransfer(treasury, fee);
            emit FeeTaken(address(token), treasury, fee);
        }
    }

    /// @dev Approve, call SpokePool, then reset approval.
    function _approveCallAndReset(IERC20 token, uint256 amount, bytes memory data) internal {
        token.safeApprove(SPOKE_POOL, 0);
        token.safeApprove(SPOKE_POOL, amount);
        _callSpokePool(data, 0);
        token.safeApprove(SPOKE_POOL, 0);
    }

    /// @dev Call SpokePool with encoded data and optional ETH value.
    function _callSpokePool(bytes memory data, uint256 value) internal {
        (bool success, ) = payable(SPOKE_POOL).call{value: value}(data);
        if (!success) revert Wrapper_SpokeCallFailed();
    }

    /// @dev Encode deposit() calldata with bytes32 parameters.
    function _encodeDepositCalldata(DepositInputBytes32 calldata d, uint256 netInputAmount) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                V3SpokePoolInterface.deposit.selector,
                d.depositor,
                d.recipient,
                d.inputToken,
                d.outputToken,
                netInputAmount,
                d.outputAmount,
                d.destinationChainId,
                d.exclusiveRelayer,
                d.quoteTimestamp,
                d.fillDeadline,
                d.exclusivityParameter,
                d.message
            );
    }

    /// @dev Encode depositNow() calldata with bytes32 parameters.
    function _encodeDepositNowCalldata(DepositInputBytes32Now calldata d, uint256 netInputAmount) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                V3SpokePoolInterface.depositNow.selector,
                d.depositor,
                d.recipient,
                d.inputToken,
                d.outputToken,
                netInputAmount,
                d.outputAmount,
                d.destinationChainId,
                d.exclusiveRelayer,
                d.fillDeadlineOffset,
                d.exclusivityDeadline,
                d.message
            );
    }

    /// @dev Encode depositV3() calldata with address parameters.
    function _encodeDepositCalldataV3(DepositInput calldata d, uint256 netInputAmount) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                V3SpokePoolInterface.depositV3.selector,
                d.depositor,
                d.recipient,
                d.inputToken,
                d.outputToken,
                netInputAmount,
                d.outputAmount,
                d.destinationChainId,
                d.exclusiveRelayer,
                d.quoteTimestamp,
                d.fillDeadline,
                d.exclusivityParameter,
                d.message
            );
    }

    function _computeFeeAndNet(uint256 gross) internal view returns (uint256 fee, uint256 net) {
        if (feeRate == 0 || gross == 0) return (0, gross);
        fee = (gross * feeRate) / RATE_DENOMINATOR;
        net = gross - fee;
    }

    /**
     * @dev Converts an address to bytes32.
     * @param _addr The address to convert.
     * @return The bytes32 representation of the address.
     */
    function _addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }

    // @dev Converts a bytes32 to an address.
    // @param _b The bytes32 to convert.
    // @return The address representation of the bytes32.
    function _bytes32ToAddress(bytes32 _b) internal pure returns (address) {
        return address(uint160(uint256(_b)));
    }

    receive() external payable {}
}
