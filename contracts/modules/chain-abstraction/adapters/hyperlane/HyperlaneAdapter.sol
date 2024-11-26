// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IHyperlaneAdapter} from "./interfaces/IHyperlaneAdapter.sol";
import {IMailbox} from "./interfaces/IMailbox.sol";
import {StandardHookMetadata} from "./libs/StandardHookMetadata.sol";
import {BaseAdapter, IController} from "../BaseAdapter.sol";

/// @title Hyperlane Adapter
/// @notice Adapter contract that integrates with the Hyperlane messaging bridge to send and receive messages.
contract HyperlaneAdapter is BaseAdapter, IHyperlaneAdapter {
    /// @notice Error messages when quoted fee after deductions is too low
    error Adapter_FeeTooLow(uint256 requiredFee, uint256 deductedFee);

    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, uint32 domainId);

    /// @notice The maximum gas limit the transaction will consume on destination
    uint256 public immutable GAS_LIMIT;

    /// @notice Address of the Hyperlane bridge on the same chain.
    /// @dev Calls to handle should only originate from this address.
    IMailbox public immutable BRIDGE;

    /// @notice Maps Hyperlane's domain ID to the corresponding chain ID.
    mapping(uint32 => uint256) public _domainIdChains;

    /// @notice Maps chain ID to the corresponding Hyperlane domain ID.
    mapping(uint256 => uint32) public _chainIdDomains;

    /// @notice Constructor to initialize the HyperlaneAdapter.
    /// @param _bridgeRouter Address of the Hyperlane bridge router on the same chain.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message.
    /// @param treasury Address of the treasury.
    /// @param fee Fee to be charged.
    /// @param chainIds Array of chain IDs supported by the adapter.
    /// @param domainIds Array of domain IDs specific to the Hyperlane for the chain IDs above.
    constructor(
        address _bridgeRouter,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        uint256 _gasLimit,
        uint256[] memory chainIds,
        uint32[] memory domainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, fee, owner) {
        if (_bridgeRouter == address(0)) revert Adapter_InvalidParams();
        GAS_LIMIT = _gasLimit;
        BRIDGE = IMailbox(_bridgeRouter);
        if (domainIds.length != chainIds.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainIds.length; i++) {
            _domainIdChains[domainIds[i]] = chainIds[i];
            _chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to Hyperlane.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Gets a quote for the message and refunds any unused collects.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param refundAddress The address to refund any unused gas fees.
    /// @param message The message data to be relayed.
    /// @return transferId The transfer ID of the relayed message.
    function relayMessage(
        uint256 destChainId,
        address destination,
        address refundAddress,
        bytes memory message
    ) external payable override whenNotPaused returns (bytes32 transferId) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        uint32 destDomainId = _chainIdDomains[destChainId];
        if (destDomainId == 0 || trustedAdapters[destChainId] == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        bytes32 recipient = addressToBytes32(trustedAdapters[destChainId]);
        bytes memory relayedMessage = abi.encode(BridgedMessage(message, msg.sender, destination));

        bytes memory metadata = StandardHookMetadata.formatMetadata(0, GAS_LIMIT, refundAddress, "");
        uint256 quotedFee = BRIDGE.quoteDispatch(destDomainId, recipient, relayedMessage, metadata);
        _collectAndRefundFees(quotedFee, refundAddress);

        transferId = BRIDGE.dispatch{value: quotedFee}(destDomainId, recipient, relayedMessage, metadata);
    }

    /// @notice Calculates the fees required for sending a message using the Bridge's onchain quote function
    /// @notice The calculated fee includes the protocol fee if includeFee is true
    /// @param destination The destination address
    /// @param chainId The destination chain ID
    /// @param message The message data
    /// @param includeFee Whether to include the protocol fee in the calculation
    /// @return The calculated fee amount
    function quoteMessage(address destination, uint256 chainId, bytes calldata message, bool includeFee) external view returns (uint256) {
        uint32 destDomainId = _chainIdDomains[chainId];
        bytes memory _payload = abi.encode(BridgedMessage(message, msg.sender, destination));
        bytes memory metadata = StandardHookMetadata.formatMetadata(0, GAS_LIMIT, msg.sender, "");

        uint256 fee = BRIDGE.quoteDispatch(destDomainId, addressToBytes32(destination), _payload, metadata);
        if (includeFee) {
            return fee + calculateFee(fee);
        } else {
            return fee;
        }
    }

    /// @notice Receives a message from Hyperlane.
    /// @param _origin The domain ID of the origin chain.
    /// @param _originSender The sender address on the origin chain, in bytes32 format to support non-EVM chains.
    /// @param _callData The calldata of the message.
    function handle(uint32 _origin, bytes32 _originSender, bytes calldata _callData) external payable override whenNotPaused {
        uint256 chainId = _domainIdChains[_origin];
        if (address(BRIDGE) != msg.sender) revert Adapter_Unauthorised();

        _registerMessage(bytes32ToAddress(_originSender), _callData, chainId);
    }

    /// @notice Registers a received message and processes it
    /// @dev Overloaded function that doesn't use a transfer id. Removes functionality to check for duplicate messages.
    /// @param originSender The address of the sender on the origin chain.
    /// @param message The message data.
    /// @param originChain The origin chain ID.
    function _registerMessage(address originSender, bytes memory message, uint256 originChain) internal {
        // Origin sender must be a trusted adapter
        if (trustedAdapters[originChain] != originSender) revert Adapter_Unauthorised();
        // Decode message and get the controller
        BridgedMessage memory bridgedMsg = abi.decode(message, (BridgedMessage));

        IController(bridgedMsg.destController).receiveMessage(bridgedMsg.message, originChain, bridgedMsg.originController);
    }

    /// @dev Internal function to collect fees and refund the difference if necessary
    /// @param quotedFee The quoted fee amount
    function _collectAndRefundFees(uint256 quotedFee, address refundAddress) internal {
        _deductFee(quotedFee);
        uint256 pFee = calculateFee(quotedFee);
        if (quotedFee + pFee > msg.value) revert Adapter_FeeTooLow(quotedFee + pFee, msg.value);
        if (quotedFee + pFee < msg.value) {
            // refund excess
            (bool success, ) = refundAddress.call{value: msg.value - quotedFee - pFee}("");
            if (!success) revert Adapter_FeeTransferFailed();
        }
    }

    /// @notice Sets domain IDs and corresponding chain IDs.
    /// @dev Only the owner can call this function.
    /// @param domainId Array of domain IDs.
    /// @param chainId Array of chain IDs corresponding to the domain IDs.
    function setDomainId(uint32[] memory domainId, uint256[] memory chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainId.length != chainId.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainId.length; i++) {
            _domainIdChains[domainId[i]] = chainId[i];
            _chainIdDomains[chainId[i]] = domainId[i];
            emit DomainIdAssociated(chainId[i], domainId[i]);
        }
    }

    /// @dev Converts an address to bytes32.
    /// @param _addr The address to be converted to bytes32.
    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }

    /// @dev Converts bytes32 to address.
    /// @param _bytes The bytes32 to be converted to address.
    function bytes32ToAddress(bytes32 _bytes) internal pure returns (address) {
        return address(uint160(uint256(_bytes)));
    }
}
