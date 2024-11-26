// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {AxelarExecutable} from "./axelar/AxelarExecutable.sol";
import {IAxelarGateway} from "./interfaces/IAxelarGateway.sol";
import {IAxelarGasService} from "./interfaces/IAxelarGasService.sol";
import {StringToAddress, AddressToString} from "./libs/AddressStrings.sol";
import {BaseAdapter} from "../BaseAdapter.sol";

/// @title AxelarAdapter Adapter
/// @notice Adapter contract that integrates with the Axelar messaging bridge to send and receive messages.
contract AxelarAdapter is BaseAdapter, AxelarExecutable {
    /// @notice Address of the Axelar gas service on the same chain.
    IAxelarGasService public immutable axlGasService;

    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, string domainId);

    /// @notice Maps Axelar's domain ID (chain name) to the corresponding chain ID.
    mapping(string => uint256) public _domainIdChains;

    /// @notice Maps chain ID to the corresponding Axelar chain name.
    mapping(uint256 => string) public _chainIdDomains;

    /// @notice Constructor to initialize the AxelarAdapter.
    /// @param _bridgeRouter Address of the Axelar bridge router on the same chain.
    /// @param name Name of the adapter.
    /// @param minimumGas Minimum gas required to relay a message.
    /// @param treasury Address of the treasury.
    /// @param fee Fee to be charged.
    /// @param chainIds Array of chain IDs supported by the adapter.
    /// @param domainIds Array of domain IDs specific to the Axelar for the chain IDs above.
    constructor(
        address _bridgeRouter,
        address _axelarGasService,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        uint256[] memory chainIds,
        string[] memory domainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, fee, owner) AxelarExecutable(_bridgeRouter) {
        axlGasService = IAxelarGasService(_axelarGasService);
        if (_bridgeRouter == address(0)) revert Adapter_InvalidParams();
        if (domainIds.length != chainIds.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainIds.length; i++) {
            _domainIdChains[domainIds[i]] = chainIds[i];
            _chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to Axelar.
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender.
    /// @dev Refunds back to refundAddress any unused gas fees from Axelar. Returned value is always 0 since no id is produced, should be ignored.
    /// @param destChainId The destination chain ID.
    /// @param destination The destination address.
    /// @param refundAddress The address to refund any unused gas fees.
    /// @param message The message data to be relayed.
    /// @return transferId Bytes32(0), Axelar doesn't return a transferId.
    function relayMessage(
        uint256 destChainId,
        address destination,
        address refundAddress,
        bytes memory message
    ) external payable override whenNotPaused returns (bytes32) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message
        string memory destDomainId = _chainIdDomains[destChainId];
        if (bytes(destDomainId).length == 0 || trustedAdapters[destChainId] == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        string memory recipient = AddressToString.toString(trustedAdapters[destChainId]);
        bytes memory relayedMessage = abi.encode(BridgedMessage(message, msg.sender, destination));

        uint256 remainingValue = _deductFee(msg.value);

        axlGasService.payNativeGasForContractCall{value: remainingValue}(address(this), destDomainId, recipient, relayedMessage, refundAddress);

        gateway.callContract(destDomainId, recipient, relayedMessage);
    }

    /**
     * @notice logic to be executed on dest chain
     * @dev the message origin is verified in the parent function
     * @dev overriden to include commandId
     * @param commandId unique identifier for the command
     * @param _sourceChain blockchain where tx is originating from
     * @param _sourceAddress address on src chain where tx is originating from
     * @param _payload encoded gmp message sent from src chain
     */
    function _execute(
        bytes32 commandId,
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) internal override whenNotPaused {
        _registerMessage(StringToAddress.toAddress(_sourceAddress), commandId, _payload, _domainIdChains[_sourceChain]);
    }

    /// @notice Sets domain IDs and corresponding chain IDs.
    /// @dev Only the owner can call this function.
    /// @param domainId Array of domain IDs.
    /// @param chainId Array of chain IDs corresponding to the domain IDs.
    function setDomainId(string[] memory domainId, uint256[] memory chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainId.length != chainId.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainId.length; i++) {
            _domainIdChains[domainId[i]] = chainId[i];
            _chainIdDomains[chainId[i]] = domainId[i];
            emit DomainIdAssociated(chainId[i], domainId[i]);
        }
    }
}
