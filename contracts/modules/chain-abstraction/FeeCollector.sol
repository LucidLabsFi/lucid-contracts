// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2StepInit, OwnableInit} from "../../utils/access/Ownable2StepInit.sol";

/**
 * @title FeeCollector
 * @notice This contract collects a fee % in any ERC20 token and sends it to a treasury address
 */
contract FeeCollector is Ownable2StepInit {
    using SafeERC20 for IERC20;

    /// @notice Error thrown when fee exceeds the maximum fee
    error FeeCollector_FeeExceedsMaxBps();
    /// @notice Error thrown when treasury is the zero address
    error FeeCollector_TreasuryZeroAddress();

    /// @notice Event emitted when a fee is received
    event FeeReceived(address indexed token, uint256 amount);

    /// @notice The divisor used to calculate fees (one percent equals 1000)
    uint256 public constant FEE_DIVISOR = 1e5;
    /// @notice The maximum fee basis points (1%)
    uint256 public constant MAX_FEE_BPS = 1000;
    /// @notice The fee in basis points. Should be up to MAX_FEE_BPS (one percent equals 1000)
    uint256 public feeBps;
    /// @notice The treasury address where fees are sent
    address public treasury;

    /**
     * @notice Constructor
     * @param _feeBps The fee in basis points (one percent equals 1000)
     * @param _treasury The treasury address where fees are sent
     * @param _owner The owner of the contract
     */
    constructor(uint256 _feeBps, address _treasury, address _owner) OwnableInit(_owner) {
        if (_feeBps > MAX_FEE_BPS) revert FeeCollector_FeeExceedsMaxBps();
        if (_treasury == address(0)) revert FeeCollector_TreasuryZeroAddress();
        feeBps = _feeBps;
        treasury = _treasury;
    }

    /**
     * @notice Collects the fee from the sender
     * @dev Approval needs to be given to this contract prior to calling this function
     * @param token The token address
     * @param amount The amount to collect
     */
    function collect(address token, uint256 amount) external {
        uint256 fee = quote(amount);
        if (fee > 0) {
            IERC20(token).safeTransferFrom(_msgSender(), address(this), fee);
            IERC20(token).safeTransfer(treasury, fee);
            emit FeeReceived(token, fee);
        }
    }

    /**
     * @notice Quotes the fee for a given amount
     * @dev External contracts should quote the fee to give an approval before calling collect
     * @param amount The amount to quote
     * @return fee The fee amount
     */
    function quote(uint256 amount) public view returns (uint256 fee) {
        if (feeBps == 0) {
            fee = 0;
        }
        fee = (amount * feeBps) / FEE_DIVISOR;
    }

    /**
     * @notice Sets the fee basis points
     * @dev Only the owner can call this function
     * @param _feeBps The fee in basis points (one percent equals 1000)
     */
    function setFeeBps(uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeCollector_FeeExceedsMaxBps();
        feeBps = _feeBps;
    }

    /**
     * @notice Sets the treasury address
     * @dev Only the owner can call this function
     * @param _treasury The treasury address where fees are sent
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert FeeCollector_TreasuryZeroAddress();
        treasury = _treasury;
    }
}
