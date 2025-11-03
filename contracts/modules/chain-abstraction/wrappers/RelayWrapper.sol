// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {Ownable2StepInit, OwnableInit} from "../../../utils/access/Ownable2StepInit.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRelayDepository} from "./interfaces/IRelayDepository.sol";

contract RelayWrapper is Ownable2StepInit, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ===== Events =====
    event TransferSent(address indexed sender, address indexed inputToken, bytes32 indexed orderId, uint256 amountIn, bytes emittedMessage);
    event FeeTaken(address indexed token, address indexed treasury, uint256 amount);
    event FeeRateSet(uint256 oldRate, uint256 newRate);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);

    // ===== Errors =====
    error Wrapper_InvalidFeeRate();
    error Wrapper_TreasuryZeroAddress();
    error Wrapper_RelayDepositoryZeroAddress();
    error Wrapper_TransferFailed();
    error Wrapper_MsgValueNotZero();
    error Wrapper_FeeOnTransferToken();
    error Wrapper_ZeroAddress();
    error Wrapper_AmountZero();

    uint256 public constant RATE_DENOMINATOR = 100_000; // 100.00%
    uint256 public constant MAX_FEE_RATE = 5_000; // 5.00%

    address public immutable RELAY_DEPOSITORY;
    address payable public treasury;

    uint256 public feeRate; // 0..100_000

    /**
     * @param _relayDepository The Relay Depository address
     * @param _owner The owner address
     * @param _treasury The treasury address
     * @param _feeRate The fee rate
     */
    constructor(address _relayDepository, address _owner, address payable _treasury, uint256 _feeRate) OwnableInit(_owner) {
        if (_relayDepository == address(0)) revert Wrapper_RelayDepositoryZeroAddress();
        if (_treasury == address(0) && _feeRate > 0) revert Wrapper_TreasuryZeroAddress();
        if (_feeRate > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();

        RELAY_DEPOSITORY = _relayDepository;
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
     * @notice Deposit assets to be transferred via Relay Depository. Amount of inputToken should be inclusive of any fees. Use quote() to calculate fees.
     * An ERC20 approval of the amount must be given to this contract prior to calling this function if not using native.
     * @param inputToken The address of the input token (address(0) for native)
     * @param amount The amount to deposit
     * @param id The unique order ID
     * @param emittedMessage The message to emit with the transfer
     */
    function depositErc20(address inputToken, uint256 amount, bytes32 id, bytes calldata emittedMessage) external payable nonReentrant whenNotPaused {
        if (msg.value != 0) revert Wrapper_MsgValueNotZero();
        if (amount == 0) revert Wrapper_AmountZero();

        (uint256 fee, uint256 net) = _computeFeeAndNet(amount);

        IERC20 token = IERC20(inputToken);

        // Pull gross, disallow fee-on-transfer by checking balance delta
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balBefore;
        if (received != amount) revert Wrapper_FeeOnTransferToken();

        // Send fee to treasury
        if (fee > 0) token.safeTransfer(treasury, fee);

        // Approve only NET, call Relay Depository, then zero allowance
        token.safeApprove(RELAY_DEPOSITORY, 0);
        token.safeApprove(RELAY_DEPOSITORY, net);

        IRelayDepository(RELAY_DEPOSITORY).depositErc20(msg.sender, inputToken, net, id);

        token.safeApprove(RELAY_DEPOSITORY, 0);
        emit TransferSent(msg.sender, inputToken, id, net, emittedMessage);
    }

    /**
     * @notice Deposit assets to be transferred via Relay Depository. Msg.value should be inclusive of any fees. Use quote() to calculate fees.
     * @param id The unique order ID
     * @param emittedMessage The message to emit with the transfer
     */
    function depositNative(bytes32 id, bytes calldata emittedMessage) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert Wrapper_AmountZero();
        (uint256 fee, uint256 net) = _computeFeeAndNet(msg.value);

        // Send fee to treasury
        if (fee > 0) {
            (bool success, ) = treasury.call{value: fee}("");
            if (!success) revert Wrapper_TransferFailed();
        }

        IRelayDepository(RELAY_DEPOSITORY).depositNative{value: net}(msg.sender, id);
        emit TransferSent(msg.sender, address(0), id, net, emittedMessage);
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

    function _computeFeeAndNet(uint256 gross) internal view returns (uint256 fee, uint256 net) {
        if (feeRate == 0 || gross == 0) return (0, gross);
        fee = (gross * feeRate) / RATE_DENOMINATOR;
        net = gross - fee;
    }

    receive() external payable {}
}
