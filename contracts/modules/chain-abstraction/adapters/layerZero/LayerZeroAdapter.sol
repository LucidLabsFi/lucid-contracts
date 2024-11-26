// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "./layerZero/OApp.sol";
import {BaseAdapter} from "../BaseAdapter.sol";

/// @title LayerZeroAdapter
/// @notice Adapter contract that integrates with Layer Zero's V2 Messaging Bridge. The adapter is an OApp.
contract LayerZeroAdapter is BaseAdapter, OApp {
    /// @notice Error messages when quoted fee after deductions is too low
    error Adapter_FeeTooLow(uint256 requiredFee, uint256 deductedFee);
    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, uint32 domainId);
    /// @notice Event emitted when the Layer Zero options are set
    event LzOptionsSet(bytes options);
    /// @notice Options to be used when sending a message to Layer Zero
    bytes public lzSendOptions;
    /// @notice Maps Layer Zero's eID (domain ID) to chain ID
    mapping(uint32 => uint256) public _domainIdChains;

    /// @notice Maps chain ID to Layer Zero's eID (domain ID)
    mapping(uint256 => uint32) public _chainIdDomains;

    /// @notice Constructor to initialize the LayerZeroAdapter
    /// @param _bridgeRouter Address of the Layer Zero Endpoint on the same chain
    /// @param name Name of the adapter
    /// @param minimumGas Minimum gas required to relay a message
    /// @param treasury Address where the protocol fees are sent
    /// @param fee Fee to be charged by the protocol in basis points
    /// @param chainIds Array of chain IDs supported by the adapter
    /// @param domainIds Array of domain IDs specific to the chain IDs above
    constructor(
        address _bridgeRouter,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        bytes memory options,
        uint256[] memory chainIds,
        uint32[] memory domainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, fee, owner) OApp(_bridgeRouter, owner) {
        if (domainIds.length != chainIds.length) revert Adapter_InvalidParams();
        lzSendOptions = options;
        emit LzOptionsSet(options);
        for (uint256 i = 0; i < domainIds.length; i++) {
            _domainIdChains[domainIds[i]] = chainIds[i];
            _chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to Layer Zero
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender
    /// @param destChainId The destination chain ID
    /// @param destination The destination address. Usually the controller that will eventually receive the message
    /// @param refundAddress The address to refund any unused gas fees
    /// @param message The message data to be relayed
    /// @return transferId The transfer ID of the relayed message
    function relayMessage(
        uint256 destChainId,
        address destination,
        address refundAddress,
        bytes calldata message
    ) external payable override whenNotPaused returns (bytes32 transferId) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message

        uint32 destDomainId = _chainIdDomains[destChainId];
        if (destDomainId == 0 || trustedAdapters[destChainId] == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        bytes memory payload = abi.encode(BridgedMessage(message, msg.sender, destination));
        uint256 nativeFee = _quote(destDomainId, payload, lzSendOptions, false).nativeFee;

        _deductFee(nativeFee);
        uint256 pFee = calculateFee(nativeFee);

        if (nativeFee + pFee > msg.value) revert Adapter_FeeTooLow(nativeFee + pFee, msg.value);

        transferId = _lzSend(
            destDomainId,
            payload,
            lzSendOptions,
            MessagingFee(msg.value - pFee, 0), // Fee in native gas only, not in ZRO token.
            payable(refundAddress) // Refund address in case of failed source message.
        ).guid;
    }

    ///@dev Overriding internal function in OAppSender because msg.value contains multiple different fees
    function _payNative(uint256 amount) internal override returns (uint256) {
        return amount;
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
        bytes memory payload = abi.encode(BridgedMessage(message, msg.sender, destination));
        MessagingFee memory fee = _quote(destDomainId, payload, lzSendOptions, false);
        if (includeFee) {
            return fee.nativeFee + calculateFee(fee.nativeFee);
        } else {
            return fee.nativeFee;
        }
    }

    /**
     * @dev Entry point for receiving messages or packets from the endpoint.
     * @param _origin The origin information containing the source endpoint and sender address.
     *  - srcEid: The source chain endpoint ID.
     *  - sender: The sender address on the src chain.
     *  - nonce: The nonce of the message.
     * @param _guid The unique identifier for the received LayerZero message.
     * @param _payload The payload of the received message.
     * @param _executor The address of the executor for the received message.
     * @param _extraData Additional arbitrary data provided by the corresponding executor.
     *
     * @dev Entry point for receiving msg/packet from the LayerZero endpoint.
     */
    function _lzReceive(
        Origin calldata _origin, // struct containing info about the message sender
        bytes32 _guid, // global packet identifier
        bytes calldata _payload, // encoded message payload being received
        address _executor, // the Executor address.
        bytes calldata _extraData // arbitrary data appended by the Executor
    ) internal override whenNotPaused {
        // Authorisation checks completed in `lzReceive`
        _registerMessage(bytes32ToAddress(_origin.sender), _guid, _payload, _domainIdChains[_origin.srcEid]);
    }

    // /// @notice
    // /// @dev The eid must be previously configured with setDomainId
    // /// @dev must-have configurations for standard OApps
    // /// @param _eid The eid of the destination chain
    // /// @param _peer The address of the adapter on the destination chain, formatted as bytes32 with zero padding
    // function setPeer(uint32 _eid, bytes32 _peer) public virtual onlyOwner {
    //     peers[_eid] = _peer; // Array of peer addresses by destination.
    //     emit PeerSet(_eid, _peer); // Event emitted each time a peer is set.
    // }

    /// @notice Sets the domain IDs and corresponding chain IDs
    /// @dev Only callable by the owner
    /// @param domainId Array of domain IDs
    /// @param chainId Array of chain IDs corresponding to the domain IDs
    function setDomainId(uint32[] memory domainId, uint256[] memory chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainId.length != chainId.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainId.length; i++) {
            _domainIdChains[domainId[i]] = chainId[i];
            _chainIdDomains[chainId[i]] = domainId[i];
            emit DomainIdAssociated(chainId[i], domainId[i]);
        }
    }

    /// @notice Sets the Layer Zero _LzSendOptions used when relaying a message
    /// @dev Only callable by the owner
    /// @param options The options to be set
    function setLzSendOptions(bytes calldata options) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lzSendOptions = options;
        emit LzOptionsSet(options);
    }

    /**
     * @dev Converts an address to bytes32.
     * @param _addr The address to convert.
     * @return The bytes32 representation of the address.
     */
    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }

    /**
     * @dev Converts bytes32 to an address.
     * @param _b The bytes32 value to convert.
     * @return The address representation of bytes32.
     */
    function bytes32ToAddress(bytes32 _b) internal pure returns (address) {
        return address(uint160(uint256(_b)));
    }
}
