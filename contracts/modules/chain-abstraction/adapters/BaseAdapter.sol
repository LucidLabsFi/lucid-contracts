// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.19 <=0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IController} from "../interfaces/IController.sol";
import {IBaseAdapter} from "./interfaces/IBaseAdapter.sol";

/// @title BaseAdapter
/// @notice Abstract base contract for adapters used to send and receive messages
abstract contract BaseAdapter is IBaseAdapter, Pausable, AccessControl {
    /* ========== ERRORS ========== */
    /// @notice Error when the fee transfer fails
    error Adapter_FeeTransferFailed();

    /// @notice Error when the provided value is less than the minimum gas limit
    error Adapter_ValueIsLessThanLimit();

    /// @notice Error when the address is invalid
    error Adapter_InvalidAddress();

    /// @notice Error when the parameters are invalid
    error Adapter_InvalidParams();

    /// @notice Error when the sender is unauthorised to perform an action
    error Adapter_Unauthorised();

    /// @notice Error when the message is invalid
    error Adapter_InvalidMessage();

    /// @notice Error when the Bridge message ID is already processed
    error Adapter_AlreadyProcessed();

    /* ========== EVENTS ========== */

    /// @notice Emitted when the protocol fee is set
    event ProtocolFeeSet(uint48 protocolFee);

    /// @notice Emitted when the minimum gas is set
    event MinGasSet(uint256 minGas);

    event TrustedAdapterSet(address indexed adapter, uint256 chainId);

    /* ========== STATE VARIABLES ========== */
    /// @notice Stores received transfer IDs to prevent double processing
    mapping(bytes32 => bool) internal _processedTransferIds;

    /// @notice Maps chain ID to the origin forwarder address (trusted adapter on the other network)
    /// @dev Only calls from these addresses are allowed when messages are received
    mapping(uint256 => address) public trustedAdapters;

    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");

    /// @notice Fee paid to protocol in basis points (3 decimal places)
    uint48 public protocolFee;

    /// @notice Decimal value for fee calculations (one percent equals 1000)
    uint48 public constant FEE_DECIMALS = 1e5;

    /// @notice Address where the protocol receives fees
    address public protocolFeeRecipient;

    /// @notice Minimum relayer fee that will be accepted
    uint256 public minGas;

    /// @notice Name of the adapter
    string public adapterName;

    /// @notice Constructor to initialize the BaseAdapter
    /// @param name Name of the adapter
    /// @param minimumGas Minimum gas required to relay a message
    /// @param treasury Address where the protocol fees are sent
    /// @param fee Fee to be charged by the protocol in basis points
    constructor(string memory name, uint256 minimumGas, address treasury, uint48 fee, address owner) {
        _setupRole(DEFAULT_ADMIN_ROLE, owner);
        _setupRole(PAUSE_ROLE, owner);
        minGas = minimumGas;
        adapterName = name;
        protocolFeeRecipient = treasury;
        protocolFee = fee;

        emit ProtocolFeeSet(fee);
        emit MinGasSet(minimumGas);
    }

    /// @notice Checks if the given adapter is a trusted adapter for the specified chain ID
    /// @param chainId The chain ID to check
    /// @param adapter The adapter address to verify
    /// @return True if the adapter is trusted, false otherwise
    function isTrustedAdapter(uint256 chainId, address adapter) external view returns (bool) {
        return trustedAdapters[chainId] == adapter;
    }

    /// @notice Checks if the given chain ID is supported by the adapter
    /// @param chainId The chain ID to check
    /// @return True if the chain ID is supported, false otherwise
    function isChainIdSupported(uint256 chainId) public view returns (bool) {
        return trustedAdapters[chainId] != address(0);
    }

    /// @notice Registers a received message and processes it
    /// @dev Internal function that checks the origin sender, decodes the message, and processes it through the controller
    /// @param originSender The address of the sender on the origin chain
    /// @param transferId The ID of the transfer
    /// @param message The message data
    /// @param originChain The origin chain ID
    function _registerMessage(address originSender, bytes32 transferId, bytes memory message, uint256 originChain) internal {
        // Origin sender must be a trusted adapter
        if (trustedAdapters[originChain] != originSender) revert Adapter_Unauthorised();
        // Decode message and get the controller
        BridgedMessage memory bridgedMsg = abi.decode(message, (BridgedMessage));

        // If transfer id is already processed, revert
        if (_processedTransferIds[transferId]) revert Adapter_AlreadyProcessed();
        _processedTransferIds[transferId] = true;

        IController(bridgedMsg.destController).receiveMessage(bridgedMsg.message, originChain, bridgedMsg.originController);
    }

    /// @notice Deducts the protocol fee from the given amount
    /// @dev Internal function that checks minimum gas, calculates the fee, and transfers it to the protocol fee recipient
    /// @param amount The amount from which the fee will be deducted
    /// @return The amount after deducting the fee (remaining msg.value)
    function _deductFee(uint256 amount) internal returns (uint256) {
        if (msg.value < minGas && minGas != 0) revert Adapter_ValueIsLessThanLimit();
        if (protocolFeeRecipient == address(0)) revert Adapter_FeeTransferFailed();
        uint256 feeAmount = calculateFee(amount);
        if (feeAmount > 0) {
            // Transfer fee to protocol
            (bool success, ) = protocolFeeRecipient.call{value: feeAmount}("");
            if (!success) revert Adapter_FeeTransferFailed();
        }
        return amount - feeAmount;
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        if (protocolFee == 0) return 0;
        return Math.mulDiv(amount, protocolFee, FEE_DECIMALS);
    }

    /// @notice Sets the trusted adapter for a specific chain ID
    /// @dev Only callable by the owner
    /// @param chainId The chain ID to set the trusted adapter for
    /// @param trustedAdapter The address of the trusted adapter
    function setTrustedAdapter(uint256 chainId, address trustedAdapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedAdapters[chainId] = trustedAdapter;
        emit TrustedAdapterSet(trustedAdapter, chainId);
    }

    /// @notice Sets the protocol fee and the recipient address
    /// @dev Only callable by the owner
    /// @param fee The new protocol fee in basis points
    /// @param treasury The address where the protocol fees will be sent
    function setProtocolFee(uint48 fee, address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (fee > 5e3) revert Adapter_InvalidParams();
        protocolFee = fee;
        protocolFeeRecipient = treasury;
        emit ProtocolFeeSet(fee);
    }

    /// @notice Sets the minimum gas required to relay a message
    /// @dev Only callable by the owner
    /// @param _minGas The new minimum gas value
    function setMinGas(uint256 _minGas) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minGas = _minGas;
        emit MinGasSet(_minGas);
    }

    /// @notice Pauses the contract.
    /// @dev Only a user with a PAUSE_ROLE can call this function.
    function pause() public onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /// @notice Unpauses the contract.
    /// @dev Only a user with a PAUSE_ROLE can call this function.
    function unpause() public onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    ///@dev Fallback function to receive ether from bridge refunds
    receive() external payable {}
}
