// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {BaseAdapter} from "../BaseAdapter.sol";
import {IConnext} from "./interfaces/IConnext.sol";

/// @title Connext Adapter
/// @notice Adapter contract that integrates with the Connext messaging bridge to send and receive messages.
contract ConnextAdapter is BaseAdapter {
    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, uint32 domainId);

    /// @notice Address of the Connext bridge on the same chain.
    /// @dev Calls to xReceive should only originate from this address.
    IConnext public immutable BRIDGE;

    /// @notice Maps Connext's domain ID to the corresponding chain ID.
    mapping(uint32 => uint256) public domainIdChains;

    /// @notice Maps chain ID to the corresponding Connext domain ID.
    mapping(uint256 => uint32) public chainIdDomains;

    /// @notice Constructor to initialize the ConnextAdapter.
    /// @param _bridgeRouter Address of the Connext bridge router on the same chain.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message.
    /// @param treasury Address of the treasury.
    /// @param fee Fee to be charged.
    /// @param chainIds Array of chain IDs supported by the adapter.
    /// @param domainIds Array of domain IDs specific to the Connext for the chain IDs above.
    /// @param owner Owner of the adapter
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
            domainIdChains[domainIds[i]] = chainIds[i];
            chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to Connext.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Connext doesn't support refunds of excess gas fees paid or onchain quoting.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param options Additional params to be used by the adapter, an abi encoded delegate address. Can call Connext-specific function post-message relay in dest, like forceUpdateSlippage
    /// @param message The message data to be relayed.
    /// @return transferId The transfer ID of the relayed message.
    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes memory message
    ) external payable override whenNotPaused returns (bytes32 transferId) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        uint32 destDomainId = chainIdDomains[destChainId];
        if (destDomainId == 0 || trustedAdapters[destChainId] == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id
        transferId = BRIDGE.xcall{value: _deductFee(msg.value)}(
            destDomainId,
            trustedAdapters[destChainId],
            address(0),
            abi.decode(options, (address)),
            0,
            0,
            abi.encode(BridgedMessage(message, msg.sender, destination))
        );
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
        uint256 chainId = domainIdChains[_origin];
        if (address(BRIDGE) != msg.sender) revert Adapter_Unauthorised();

        _registerMessage(_originSender, _transferId, _callData, chainId);
    }

    /// @notice Sets domain IDs and corresponding chain IDs.
    /// @dev Only the owner can call this function.
    /// @param domainId Array of domain IDs.
    /// @param chainId Array of chain IDs corresponding to the domain IDs.
    function setDomainId(uint32[] memory domainId, uint256[] memory chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainId.length != chainId.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainId.length; i++) {
            domainIdChains[domainId[i]] = chainId[i];
            chainIdDomains[chainId[i]] = domainId[i];
            emit DomainIdAssociated(chainId[i], domainId[i]);
        }
    }
}
