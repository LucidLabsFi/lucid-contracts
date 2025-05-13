// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {BaseAdapter, AccessControl} from "../BaseAdapter.sol";

/// @title CCIPAdapter
/// @notice Adapter contract that integrates with Chainlink's Cross-Chain Interoperability Protocol (CCIP)
contract CCIPAdapter is BaseAdapter, CCIPReceiver {
    /// @notice Event emitted when a domain ID is associated with a chain ID.
    event DomainIdAssociated(uint256 chainId, uint64 domainId);

    /// @notice Error messages when quoted fee after deductions is too low
    error Adapter_FeeTooLow(uint256 requiredFee, uint256 deductedFee);

    /// @notice Options to be used when sending a message to CCIP
    struct Options {
        address refundAddress;
        uint256 gasLimit;
    }

    /// @notice Maps CCIP's chain selector (domain ID) to chain ID
    mapping(uint64 => uint256) public domainIdChains;

    /// @notice Maps chain ID to CCIP's chain selector (domain ID)
    mapping(uint256 => uint64) public chainIdDomains;

    /// @notice Constructor to initialize the CCIPAdapter
    /// @param _bridgeRouter Address of the CCIP bridge router on the same chain
    /// @param name Name of the adapter
    /// @param minimumGas Minimum gas required to relay a message
    /// @param treasury Address where the protocol fees are sent
    /// @param fee Fee to be charged by the protocol in basis points
    /// @param chainIds Array of chain IDs supported by the adapter
    /// @param domainIds Array of domain IDs specific to the chain IDs above
    /// @param owner Owner of the adapter
    constructor(
        address _bridgeRouter,
        string memory name,
        uint256 minimumGas,
        address treasury,
        uint48 fee,
        uint256[] memory chainIds,
        uint64[] memory domainIds,
        address owner
    ) BaseAdapter(name, minimumGas, treasury, fee, owner) CCIPReceiver(_bridgeRouter) {
        if (domainIds.length != chainIds.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainIds.length; i++) {
            domainIdChains[domainIds[i]] = chainIds[i];
            chainIdDomains[chainIds[i]] = domainIds[i];
            emit DomainIdAssociated(chainIds[i], domainIds[i]);
        }
    }

    /// @notice Sends a message to CCIP
    /// @dev Overloaded function that accepts a RelayedMessage struct so that the Adapter can include msg.sender
    /// @param destChainId The destination chain ID
    /// @param destination The destination address
    /// @param options Additional params to be used by the adapter, abi encoded Options struct of refundAddress and gasLimit (address, uint256)
    /// @param message The message data to be relayed
    /// @return transferId The transfer ID of the relayed message
    function relayMessage(
        uint256 destChainId,
        address destination,
        bytes memory options,
        bytes calldata message
    ) external payable override whenNotPaused returns (bytes32 transferId) {
        // It's permissionless at this point. Msg.sender is encoded to the forwarded message

        IRouterClient router = IRouterClient(this.getRouter());

        uint64 destDomainId = chainIdDomains[destChainId];
        if (destDomainId == 0 || trustedAdapters[destChainId] == address(0)) revert Adapter_InvalidParams(); // Bridge doesn't support this chain id

        Options memory _op = abi.decode(options, (Options));
        Client.EVM2AnyMessage memory ccipMessage = _buildCCIPMessage(trustedAdapters[destChainId], message, msg.sender, destination, _op.gasLimit);

        uint256 quotedFee = router.getFee(destDomainId, ccipMessage);
        _collectAndRefundFees(quotedFee, _op.refundAddress);

        transferId = router.ccipSend{value: quotedFee}(destDomainId, ccipMessage);
    }

    /// @notice Calculates the fees required for sending a message using the Bridge's onchain quote function
    /// @notice The calculated fee includes the protocol fee if includeFee is true
    /// @param destination The destination address
    /// @param chainId The destination chain ID
    /// @param gasLimit The gas limit for the execution in the destination chain
    /// @param message The message data
    /// @param includeFee Whether to include the protocol fee in the calculation
    /// @return The calculated fee amount
    function quoteMessage(
        address destination,
        uint256 chainId,
        uint256 gasLimit,
        bytes calldata message,
        bool includeFee
    ) external view returns (uint256) {
        IRouterClient router = IRouterClient(this.getRouter());
        address receiver = trustedAdapters[chainId];

        Client.EVM2AnyMessage memory ccipMessage = _buildCCIPMessage(receiver, message, msg.sender, destination, gasLimit);

        uint256 fee = router.getFee(chainIdDomains[chainId], ccipMessage);
        if (includeFee) {
            return fee + calculateFee(fee);
        } else {
            return fee;
        }
    }

    /// @notice Sets the domain IDs and corresponding chain IDs
    /// @dev Only callable by the owner
    /// @param domainId Array of domain IDs
    /// @param chainId Array of chain IDs corresponding to the domain IDs
    function setDomainId(uint64[] memory domainId, uint256[] memory chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (domainId.length != chainId.length) revert Adapter_InvalidParams();
        for (uint256 i = 0; i < domainId.length; i++) {
            domainIdChains[domainId[i]] = chainId[i];
            chainIdDomains[chainId[i]] = domainId[i];
            emit DomainIdAssociated(chainId[i], domainId[i]);
        }
    }

    /// @notice Handles a received message
    /// @dev Internal function called by the CCIP framework when a message is received
    /// @param any2EvmMessage The received message
    function _ccipReceive(Client.Any2EVMMessage memory any2EvmMessage) internal override whenNotPaused {
        uint256 chainId = domainIdChains[any2EvmMessage.sourceChainSelector];
        address originSender = abi.decode(any2EvmMessage.sender, (address));
        _registerMessage(originSender, any2EvmMessage.messageId, any2EvmMessage.data, chainId);
    }

    /// @notice Builds a CCIP message
    /// @dev Creates an EVM2AnyMessage struct with necessary information for sending a cross-chain message
    /// @param _receiver The receiver address
    /// @param message The message data
    /// @param originSender The sender address on the origin chain
    /// @param destination The destination address
    /// @param gasLimit The gas limit for the execution in the destination chain
    /// @return The constructed CCIP message
    function _buildCCIPMessage(
        address _receiver,
        bytes calldata message,
        address originSender,
        address destination,
        uint256 gasLimit
    ) private pure returns (Client.EVM2AnyMessage memory) {
        // Create an EVM2AnyMessage struct in memory with necessary information for sending a cross-chain message
        return
            Client.EVM2AnyMessage({
                receiver: abi.encode(_receiver),
                data: abi.encode(BridgedMessage(message, originSender, destination)),
                tokenAmounts: new Client.EVMTokenAmount[](0), // No gas tokens are transferred
                extraArgs: Client._argsToBytes(
                    // Additional arguments, setting gas limit
                    Client.EVMExtraArgsV1({gasLimit: gasLimit})
                ),
                feeToken: address(0)
            });
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

    /// @notice Required override in Solidity
    function supportsInterface(bytes4 interfaceId) public pure virtual override(AccessControl, CCIPReceiver) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
