// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {BaseAdapter} from "../BaseAdapter.sol";
import {IConnext} from "./interfaces/IConnext.sol";

/// @title Connext Adapter
/// @notice Adapter contract that integrates with the Connext messaging bridge to send and receive messages.
contract ConnextAdapter is BaseAdapter {
    /// @notice Address of the Connext bridge on the same chain.
    /// @dev Calls to xReceive should only originate from this address.
    IConnext public immutable BRIDGE;

    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, uint32 domainId);

    /// @notice Maps Connext's domain ID to the corresponding chain ID.
    mapping(uint32 => uint256) public _domainIdChains;

    /// @notice Maps chain ID to the corresponding Connext domain ID.
    mapping(uint256 => uint32) public _chainIdDomains;

    /// @notice Maps the Connext transfer id of a relayed message to an address that can call Connext-specific functions.
    mapping(bytes32 => address) public _transferIdOwner;

    /// @notice Constructor to initialize the ConnextAdapter.
    /// @param _bridgeRouter Address of the Connext bridge router on the same chain.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message.
    /// @param treasury Address of the treasury.
    /// @param fee Fee to be charged.
    /// @param chainIds Array of chain IDs supported by the adapter.
    /// @param domainIds Array of domain IDs specific to the Connext for the chain IDs above.
    constructor(
        address _bridgeRouter,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        uint256[] memory chainIds,
        uint32[] memory domainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, fee, owner) {
        if (_bridgeRouter == address(0)) revert Adapter_InvalidParams();
        BRIDGE = IConnext(_bridgeRouter);
        if (domainIds.length != chainIds.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainIds.length; i++) {
            _domainIdChains[domainIds[i]] = chainIds[i];
            _chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to Connext.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Connext doesn't support refunds of excess gas fees paid or onchain quoting, hence the refund address is not used.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param refundAddress Originally the address to receive refunds of excess gas fees. Here this address can call Connext-specific function post-message relay, like forceUpdateSlippage
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
        transferId = BRIDGE.xcall{value: _deductFee(msg.value)}(
            destDomainId,
            trustedAdapters[destChainId],
            address(0),
            trustedAdapters[destChainId],
            0,
            0,
            abi.encode(BridgedMessage(message, msg.sender, destination))
        );
        // tie transferId to the refundAddress
        _transferIdOwner[transferId] = refundAddress;
    }

    /// @notice Receives a message from Connext.
    /// @param _transferId The ID of the transfer.
    /// @param _amount The amount of asset transferred.
    /// @param _asset The asset transferred.
    /// @param _originSender The sender address on the origin chain.
    /// @param _origin The domain ID of the origin chain.
    /// @param _callData The calldata of the message.
    /// @return The result of the received message processing.
    function xReceive(
        bytes32 _transferId,
        uint256 _amount,
        address _asset,
        address _originSender,
        uint32 _origin,
        bytes calldata _callData
    ) external whenNotPaused returns (bytes memory) {
        uint256 chainId = _domainIdChains[_origin];
        if (address(BRIDGE) != msg.sender) revert Adapter_Unauthorised();

        _registerMessage(_originSender, _transferId, _callData, chainId);
    }

    /// @notice Used to manually update the slippage for a transfer in Connext. Must be called in the destination chain.
    /// @dev Must be called by the refundAddress of the relayed message.
    /// @param _params The TransferInfo struct of the transfer. Its hash should produce the transferId, otherwise the data in the struct is wrong.
    /// @param _slippage The new slippage value.
    function forceUpdateSlippage(IConnext.TransferInfo calldata _params, uint256 _slippage) external {
        bytes32 transferId = keccak256(abi.encode(_params)); // The transferId is the hash of the TransferInfo struct
        if (_transferIdOwner[transferId] != msg.sender) revert Adapter_Unauthorised();
        BRIDGE.forceUpdateSlippage(_params, _slippage);
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
}
