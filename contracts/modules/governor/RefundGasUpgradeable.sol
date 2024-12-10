// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {MathUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import {OwnableInitUpgradeable} from "../../utils/access/upgradeable/OwnableInitUpgradeable.sol";

contract RefundGasUpgradeable is Initializable, OwnableInitUpgradeable {
    error RefundGas_NotGovernor();
    error RefundGas_EtherTransferFailed();
    error RefundGas_InvalidParams();

    event RefundableVote(address indexed voter, uint256 refundAmount, bool refundSent);
    event EtherWithdrawn(address indexed to, uint256 amount);

    address public governor;

    /// @notice The maximum priority fee used to cap gas refunds in `castRefundableVote`
    uint256 public maxRefundPriorityFee; // eg. 2 gwei;

    /// @notice The vote refund gas overhead, including 7K for ETH transfer and 29K for general transaction overhead
    uint256 public refundBaseGas; // eg. 36000;

    /// @notice The maximum gas units the DAO will refund voters on; supports about 9,190 characters
    uint256 public maxRefundGasUsed; // eg. 200_000;

    /// @notice The maximum basefee the DAO will refund voters on
    uint256 public maxRefundBaseFee; //eg. 200 gwei;

    bool public refundGasEnabled;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the RefundGas contract
     * @param _governor The address of the governor
     * @param _maxRefundPriorityFee The maximum priority fee used to cap gas refunds in `castRefundableVote`
     * @param _refundBaseGas The vote refund gas overhead, including 7K for ETH transfer and 29K for general transaction overhead
     * @param _maxRefundGasUsed The maximum gas units the DAO will refund voters on; supports about 9,190 characters
     * @param _maxRefundBaseFee The maximum basefee the DAO will refund voters on
     * @param _initialOwner The address of the initial owner
     */
    function initialize(
        address _governor,
        uint256 _maxRefundPriorityFee,
        uint256 _refundBaseGas,
        uint256 _maxRefundGasUsed,
        uint256 _maxRefundBaseFee,
        address _initialOwner
    ) public initializer {
        maxRefundPriorityFee = _maxRefundPriorityFee;
        refundBaseGas = _refundBaseGas;
        maxRefundGasUsed = _maxRefundGasUsed;
        maxRefundBaseFee = _maxRefundBaseFee;
        refundGasEnabled = true;
        governor = _governor;
        __OwnableInit_init(_initialOwner);
    }

    /**
     * @notice Refund gas to the voter
     * @dev Only the governor can call this function
     * @param voter The address of the voter
     * @param startGas The gas used at the start of the transaction
     */
    function refundGas(address payable voter, uint256 startGas) public {
        if (msg.sender != governor) revert RefundGas_NotGovernor();

        if (!refundGasEnabled) {
            return;
        }
        unchecked {
            uint256 balance = address(this).balance;
            if (balance == 0) {
                return;
            }
            uint256 basefee = MathUpgradeable.min(block.basefee, maxRefundBaseFee);
            uint256 gasPrice = MathUpgradeable.min(tx.gasprice, basefee + maxRefundPriorityFee);
            uint256 adjustedStartGas = (startGas * 63) / 64;
            uint256 gasUsed = MathUpgradeable.min(adjustedStartGas + refundBaseGas - gasleft(), maxRefundGasUsed);
            uint256 refundAmount = MathUpgradeable.min(gasPrice * gasUsed, balance);
            (bool refundSent, ) = voter.call{value: refundAmount}("");
            if (!refundSent) revert RefundGas_EtherTransferFailed();
            emit RefundableVote(voter, refundAmount, refundSent);
        }
    }

    /**
     * @notice Enable or disable gas refunds
     * @dev Only the owner can call this function
     * @param _enable True to enable gas refunds, false to disable
     */
    function enable(bool _enable) public onlyOwner {
        refundGasEnabled = _enable;
    }

    /**
     * @notice Update the governor
     * @dev Only the owner can call this function
     * @param _governor The address of the new governor
     */
    function updateGovernor(address _governor) public onlyOwner {
        governor = _governor;
    }

    /**
     * @notice Update the maximum priority fee used to cap gas refunds in `castRefundableVote`
     * @dev Only the owner can call this function
     * @param _maxRefundPriorityFee The new maximum priority fee
     */
    function updateMaxRefundPriorityFee(uint256 _maxRefundPriorityFee) public onlyOwner {
        maxRefundPriorityFee = _maxRefundPriorityFee;
    }

    /**
     * @notice Update the vote refund gas overhead
     * @dev Only the owner can call this function
     * @param _refundBaseGas The new vote refund gas overhead
     */
    function updateRefundBaseGas(uint256 _refundBaseGas) public onlyOwner {
        refundBaseGas = _refundBaseGas;
    }

    /**
     * @notice Update the maximum gas units the DAO will refund voters on
     * @dev Only the owner can call this function
     * @param _maxRefundGasUsed The new maximum gas units
     */
    function updateMaxRefundGasUsed(uint256 _maxRefundGasUsed) public onlyOwner {
        maxRefundGasUsed = _maxRefundGasUsed;
    }

    /**
     * @notice Update the maximum base fee the DAO will refund voters on
     * @dev Only the owner can call this function
     * @param _maxRefundBaseFee The new maximum base fee
     */
    function updateMaxRefundBaseFee(uint256 _maxRefundBaseFee) public onlyOwner {
        maxRefundBaseFee = _maxRefundBaseFee;
    }

    /**
     * @notice Withdraw ether from the contract
     * @dev Only the owner can call this function
     * @param _to The address to withdraw to
     * @param _amount The amount to withdraw
     */
    function withdrawEther(address payable _to, uint256 _amount) public onlyOwner {
        if ((_to == address(0)) || (_amount > address(this).balance)) revert RefundGas_InvalidParams();
        uint256 previousBalance = address(this).balance;

        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert RefundGas_EtherTransferFailed();

        assert(address(this).balance == previousBalance - _amount);
        emit EtherWithdrawn(_to, _amount);
    }

    /**
     * @notice Fallback function to receive ether
     */
    receive() external payable {}
}
