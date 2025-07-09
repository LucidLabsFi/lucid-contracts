// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {BaseAssetBridge} from "./BaseAssetBridge.sol";
import {IBaseAdapter} from "./adapters/interfaces/IBaseAdapter.sol";
import {IController} from "./interfaces/IController.sol";
import {IFeeCollector} from "./interfaces/IFeeCollector.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AssetController
 * @notice This contract is responsible for managing the minting and burning of a specified token across different chains, using a single or multiple bridge adapters.
 */
contract AssetController is Context, BaseAssetBridge, ReentrancyGuard, IController {
    /// @notice Event emitted when the token unwrapping setting is changed.
    event AllowTokenUnwrappingSet(bool allowUnwrapping);

    /// @notice Event emitted when an asset mint message is sent to another chain.
    /// @param transferId The unique identifier of the transfer.
    /// @param destChainId The destination chain ID.
    /// @param threshold The number of bridges required to relay the asset.
    /// @param sender The address of the sender.
    /// @param recipient The address of the recipient.
    /// @param amount The amount of the asset.
    event TransferCreated(
        bytes32 indexed transferId,
        uint256 indexed destChainId,
        uint256 threshold,
        address indexed sender,
        address recipient,
        uint256 amount,
        bool unwrap
    );

    /// @notice Event emitted when a transfer can now be executed.
    /// @param transferId The unique identifier of the transfer.
    event TransferExecutable(bytes32 indexed transferId);

    /// @notice Event emitted when an asset is minted on the current chain.
    /// @param transferId The unique identifier of the transfer.
    event TransferExecuted(bytes32 indexed transferId);

    /// @notice Event emitted when transfers to a specific chain are paused or unpaused.
    event TransfersPausedToChain(uint256 indexed chainId, bool paused);

    /// @notice Event emitted when a transfer is resent.
    /// @param transferId The unique identifier of the transfer.
    event TransferResent(bytes32 indexed transferId);

    /// @notice Event emitted when an asset mint message is sent to another chain via a bridgeAdapter.
    /// @param transferId The unique identifier of the transfer.
    /// @param bridgeAdapter The address of the bridge adapter.
    event TransferRelayed(bytes32 indexed transferId, address bridgeAdapter);

    /// @notice Event emitted when an asset is received from another chain.
    /// @param transferId The unique identifier of the transfer.
    /// @param originChainId The chain id of the origin chain.
    /// @param bridgeAdapter The address of the bridge adapter that sent the message.
    event TransferReceived(bytes32 indexed transferId, uint256 originChainId, address bridgeAdapter);

    /// @notice Event emitted when the minimum number of bridges required to relay an asset for multi-bridge transfers is set.
    /// @param minBridges The minimum number of bridges required.
    event MinBridgesSet(uint256 minBridges);

    /// @notice Event emitted when bridge adapters that can be used for multi-bridge transfers, bypassing the limits have been set
    /// @param adapter The address of the bridge adapter.
    /// @param enabled The status of the adapter.
    event MultiBridgeAdapterSet(address indexed adapter, bool enabled);

    /// @notice Event emitted when the controller address for a chain is set.
    /// @param controller The address of the controller.
    /// @param chainId The chain ID.
    event ControllerForChainSet(address indexed controller, uint256 chainId);

    /// @notice Error thrown when an asset controller is not deployed/supported on the other chain
    error Controller_Chain_Not_Supported();

    /// @notice Error thrown when a multibridge adapter specified is not whitelisted
    error Controller_AdapterNotSupported();

    /// @notice Error thrown when a transfer is not executable
    error Controller_TransferNotExecutable();

    /// @notice Error thrown when the transferId is not recognized
    error Controller_UnknownTransfer();

    /// @notice Error thrown when multi-bridge transfers are disabled
    error Controller_MultiBridgeTransfersDisabled();

    /// @notice Error thrown when the threshold is not met for execution
    error Controller_ThresholdNotMet();

    /// @notice Error thrown when the msg.value and the sum of fees[] don't match
    error Controller_FeesSumMismatch();

    /// @notice Error thrown when the adapter is a duplicate in the adapters array
    error Controller_DuplicateAdapter();

    /// @notice Error thrown when the ether transfer fails
    error Controller_EtherTransferFailed();

    /// @notice Error thrown when the amount passed is zero
    error Controller_ZeroAmount();

    /// @notice Error thrown when an adapter resends a transfer that has already been delivered
    error Controller_TransferResentByAadapter();

    /// @notice Error thrown when transfers to the destination chain are paused
    error Controller_TransfersPausedToDestination();

    /// @notice Error thrown when the mint function call on the token fails
    error Controller_TokenMintFailed();

    /// @notice Error thrown when the burn function call on the token fails
    error Controller_TokenBurnFailed();

    /// @notice Struct representing a bridged asset.
    /// @dev This struct holds the details of a message to be relayed to another chain.
    struct Transfer {
        address recipient;
        uint256 amount;
        bool unwrap;
        uint256 threshold;
        bytes32 transferId;
    }

    /// @notice Struct representing a received transfer.
    /// @dev This struct holds the details of a message received from another chain.
    struct ReceivedTransfer {
        address recipient;
        uint256 amount;
        bool unwrap;
        uint256 receivedSoFar;
        uint256 threshold;
        uint256 originChainId;
        bool executed;
    }

    /// @dev The fee collector contract address.
    IFeeCollector public immutable feeCollector;

    /// @dev The local token address that is being bridged.
    address public token;

    /// @dev Allow XERC20 incoming token transfers to be unwrapped into the native token using the lockbox.
    bool public allowTokenUnwrapping;

    /// @notice The function selector for the burn(uint256) function on the token.
    bytes4 public constant BURN_SELECTOR_SINGLE = bytes4(keccak256(bytes("burn(uint256)"))); // 0x42966c68

    /// @notice The function selector for the mint function on the token.
    bytes4 public immutable MINT_SELECTOR;

    /// @notice The function selector for the burn function on the token.
    bytes4 public immutable BURN_SELECTOR;

    /// @dev The minimum number of bridges required to relay an asset for multi-bridge transfers.
    uint256 public minBridges;

    /// @notice Nonce used in transferId calculation, increments after each calculation.
    uint256 public nonce;

    /// @dev Mapping of chain IDs to their respective controller addresses. This contract knows all the controllers in supported chains.
    mapping(uint256 => address) private _controllerForChain;

    /// @dev Mapping of whitelisted bridge adapters that can be used for multi-bridge transfers. Used for both sending and receiving messages.
    mapping(address => bool) public multiBridgeAdapters;

    /// @dev Indicates whether transfers to a given chain ID are currently paused
    mapping(uint256 => bool) public transfersPausedTo;

    /// @dev Mapping of transfer id to received messages
    mapping(bytes32 => ReceivedTransfer) public receivedTransfers;

    /// @dev Mapping of transfers identified by their transfer ID.
    mapping(bytes32 => Transfer) public relayedTransfers;

    /// @dev Mapping of transfer ID to destination chain ID.
    mapping(bytes32 => uint256) public destChainForMessage;

    /// @dev Mapping of transfer ID to the bridge adapter that has delivered the transfer.
    mapping(bytes32 => mapping(address => bool)) public deliveredBy;

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the contract with the given parameters.
     * @notice To configure multibridge limits, use the zero address as a bridge in `_bridges` and set the limits accordingly.
     * @param _addresses An array with four elements, containing the token address, the user that gets DEFAULT_ADMIN_ROLE and PAUSE_ROLE, the user getting only PAUSE_ROLE,
     *          the fee collector contract, the controller address in other chains for the given chain IDs (if deployed with create3).
     * @param _duration The duration it takes for the limits to fully replenish.
     * @param _minBridges The minimum number of bridges required to relay an asset for multi-bridge transfers. Setting to 0 will disable multi-bridge transfers.
     * @param _multiBridgeAdapters The addresses of the initial bridge adapters that can be used for multi-bridge transfers, bypassing the limits.
     * @param _chainId The list of chain IDs to set the controller addresses for.
     * @param _bridges The list of bridge adapter addresses that have limits set for minting and burning.
     * @param _mintingLimits The list of minting limits for the bridge adapters. It must correspond to the mint() function of the token, otherwise tokens cannot be minted
     * @param _burningLimits The list of burning limits for the bridge adapters. It must correspond to the burn() function of the token, otherwise tokens cannot be burned
     * @param _selectors Bytes4 array of mint and burn function selectors.
     */
    constructor(
        address[5] memory _addresses, //token, initialOwner, pauser, feeCollector, controllerAddress
        uint256 _duration,
        uint256 _minBridges,
        address[] memory _multiBridgeAdapters,
        uint256[] memory _chainId,
        address[] memory _bridges,
        uint256[] memory _mintingLimits,
        uint256[] memory _burningLimits,
        bytes4[2] memory _selectors
    ) BaseAssetBridge(_addresses[1], _addresses[2], _duration, _bridges, _mintingLimits, _burningLimits) {
        if ((_addresses[0] == address(0)) || (_addresses[3] == address(0))) revert Controller_Invalid_Params();
        token = _addresses[0];
        feeCollector = IFeeCollector(_addresses[3]);
        minBridges = _minBridges;
        emit MinBridgesSet(_minBridges);
        if (_multiBridgeAdapters.length > 0) {
            for (uint256 i = 0; i < _multiBridgeAdapters.length; i++) {
                multiBridgeAdapters[_multiBridgeAdapters[i]] = true;
                emit MultiBridgeAdapterSet(_multiBridgeAdapters[i], true);
            }
        }

        if (_addresses[4] != address(0)) {
            for (uint256 i = 0; i < _chainId.length; i++) {
                _controllerForChain[_chainId[i]] = _addresses[4];
                emit ControllerForChainSet(_addresses[4], _chainId[i]);
            }
        }
        allowTokenUnwrapping = false;
        emit AllowTokenUnwrappingSet(false);

        MINT_SELECTOR = _selectors[0];
        BURN_SELECTOR = _selectors[1];
    }

    /* ========== PUBLIC ========== */

    /**
     * @notice Sends a message to another chain via a bridgeAdapter to mint the asset.
     * @dev msg.value should contain the bridge adapter fee
     * @param recipient The address of the recipient. Could be the same as msg.sender.
     * @param amount The amount of the asset to mint.
     * @param unwrap Applicable only to XERC20 transfers. Used to unwrap the native asset using the lockbox on destination, if enabled on the destination.
     * @param destChainId The destination chain ID.
     * @param bridgeAdapter The address of the bridge adapter.
     * @param bridgeOptions Additional params to be used by the adapter.
     */
    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address bridgeAdapter,
        bytes memory bridgeOptions
    ) public payable nonReentrant whenNotPaused {
        if (amount == 0) revert Controller_ZeroAmount();
        if (burningCurrentLimitOf(bridgeAdapter) < amount) revert Controller_NotHighEnoughLimits();
        _useBurnerLimits(bridgeAdapter, amount);
        _burn(_msgSender(), amount);

        if (recipient == address(0)) revert Controller_Invalid_Params();
        if (getControllerForChain(destChainId) == address(0)) revert Controller_Chain_Not_Supported();
        if (transfersPausedTo[destChainId]) revert Controller_TransfersPausedToDestination();
        bytes32 transferId = calculateTransferId(destChainId);
        // Increment nonce used to create transfer id
        nonce++;

        // Store transfer data
        destChainForMessage[transferId] = destChainId;
        Transfer memory transfer = Transfer(recipient, amount, unwrap, 1, transferId);
        relayedTransfers[transferId] = transfer;

        IBaseAdapter(bridgeAdapter).relayMessage{value: msg.value}(
            destChainId,
            getControllerForChain(destChainId),
            bridgeOptions,
            abi.encode(transfer)
        );
        emit TransferCreated(transferId, destChainId, 1, _msgSender(), recipient, amount, unwrap);
        emit TransferRelayed(transferId, bridgeAdapter);
    }

    /**
     * @notice Resends a single-bridge transfer message to another chain via a bridgeAdapter
     * @notice Msg.sender will receive any refunds from excess fees paid by the bridge, if the bridge supports it.
     * @dev msg.value should contain the bridge adapter fee
     * @param transferId The unique identifier of the transfer.
     * @param adapter The address of the bridge adapter.
     * @param options Additional params to be used by the adapter.
     */
    function resendTransfer(bytes32 transferId, address adapter, bytes memory options) public payable nonReentrant whenNotPaused {
        uint256 destChainId = destChainForMessage[transferId];
        if (destChainId == 0) revert Controller_UnknownTransfer();
        Transfer memory transfer = relayedTransfers[transferId];
        if (transfer.threshold == 1) {
            uint256 _currentLimit = burningCurrentLimitOf(adapter);
            if (_currentLimit < transfer.amount) revert Controller_NotHighEnoughLimits();
            // Resend doesn't consume burn limits, since the asset is already burned, but it checks if the bridge adapter is enabled

            IBaseAdapter(adapter).relayMessage{value: msg.value}(destChainId, getControllerForChain(destChainId), options, abi.encode(transfer));
            emit TransferResent(transferId);
            emit TransferRelayed(transferId, adapter);
        } else {
            revert Controller_Invalid_Params();
        }
    }

    /**
     * @notice Sends a message to another chain via multiple bridgeAdapter to mint the asset, bypassing the individual bridge limits.
     * @notice This function uses instead higher limits, since execution goes through a minimum number of bridges.
     * @notice Msg.sender will receive any refunds from excess fees paid by the bridge, if the bridge supports it.
     * @dev Token allowance must be given before calling this function, which should include the multi-bridge fee, if any.
     * @param recipient The address of the recipient. Could be the same as msg.sender.
     * @param amount The amount of the asset to mint.
     * @param unwrap Applicable only to XERC20 transfers. Used to unwrap the native asset using the lockbox on destination, if enabled on the destination.
     * @param destChainId The destination chain ID.
     * @param adapters The addresses of the bridge adapters.
     * @param fees The fees to be paid to the bridge adapters.
     * @param options Additional params to be used by the adapter.
     */
    function transferTo(
        address recipient,
        uint256 amount,
        bool unwrap,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) public payable nonReentrant whenNotPaused {
        if (amount == 0) revert Controller_ZeroAmount();
        // Fee collection for multi-bridge transfers
        uint256 fee = feeCollector.quote(amount);
        if (fee > 0) {
            IERC20(token).transferFrom(_msgSender(), address(this), fee);
            IERC20(token).approve(address(feeCollector), fee);
            feeCollector.collect(token, fee);
        }
        _burn(_msgSender(), amount);

        uint256 _currentLimit = burningCurrentLimitOf(address(0));
        if (_currentLimit < amount) revert Controller_NotHighEnoughLimits();
        _useBurnerLimits(address(0), amount);

        _checkUniqueness(adapters);

        // Revert if threshold is higher than the number of adapters that will execute the message
        if (adapters.length < minBridges) revert Controller_Invalid_Params();
        if (recipient == address(0)) revert Controller_Invalid_Params();
        if (minBridges == 0) revert Controller_MultiBridgeTransfersDisabled();
        if (getControllerForChain(destChainId) == address(0)) revert Controller_Chain_Not_Supported();
        if (transfersPausedTo[destChainId]) revert Controller_TransfersPausedToDestination();
        // Create transfer id
        bytes32 transferId = calculateTransferId(destChainId);
        // Increment nonce used to create transfer id
        nonce++;
        Transfer memory transfer = Transfer(recipient, amount, unwrap, minBridges, transferId);

        // Store transfer data
        destChainForMessage[transferId] = destChainId;
        relayedTransfers[transferId] = transfer;

        _relayTransfer(transfer, destChainId, adapters, fees, options, msg.value);
        emit TransferCreated(transferId, destChainId, minBridges, _msgSender(), recipient, amount, unwrap);
    }

    /**
     * @notice Resends a multi-bridge transfer message to another chain via one or more multibridge whitelested bridge Adapters
     * @dev msg.value should contain the total bridge adapter fees
     * @param transferId The unique identifier of the transfer.
     * @param adapters The addresses of the bridge adapters.
     * @param fees The fees to be paid to the bridge adapters.
     * @param options Additional params to be used by the adapter.
     */
    function resendTransfer(
        bytes32 transferId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options
    ) public payable nonReentrant whenNotPaused {
        uint256 destChainId = destChainForMessage[transferId];
        if (destChainId == 0) revert Controller_UnknownTransfer();
        if (minBridges == 0) revert Controller_MultiBridgeTransfersDisabled();
        _checkUniqueness(adapters);
        Transfer memory transfer = relayedTransfers[transferId];
        // Resend doesn't uses the burn limits, since the asset is already burned and limits are global for all whitelisted multibridge adapters
        if (transfer.threshold > 1) {
            if (adapters.length != fees.length) revert Controller_Invalid_Params();

            _relayTransfer(transfer, destChainId, adapters, fees, options, msg.value);
            emit TransferResent(transferId);
        } else {
            revert Controller_Invalid_Params();
        }
    }

    /**
     * @notice Registers a received message.
     * @dev Can be called by an adapter contract only
     * @param receivedMsg The received message data in bytes.
     * @param originChain The origin chain ID.
     * @param originSender The address of the origin sender. (controller in origin chain)
     */
    function receiveMessage(bytes calldata receivedMsg, uint256 originChain, address originSender) public override nonReentrant {
        // OriginSender must be a controller on another chain
        if (getControllerForChain(originChain) != originSender) revert Controller_Invalid_Params();

        // Decode message
        Transfer memory transfer = abi.decode(receivedMsg, (Transfer));

        if (transfer.threshold == 1) {
            // Instant transfer using the bridge limits
            // Check that transfer hasn't been replayed
            if (receivedTransfers[transfer.transferId].amount != 0) revert Controller_TransferNotExecutable();
            receivedTransfers[transfer.transferId] = ReceivedTransfer({
                recipient: transfer.recipient,
                amount: transfer.amount,
                unwrap: transfer.unwrap,
                receivedSoFar: 1,
                threshold: 1,
                originChainId: originChain,
                executed: true
            });

            // Get limit of bridge
            uint256 _currentLimit = mintingCurrentLimitOf(msg.sender);
            if (_currentLimit < transfer.amount) revert Controller_NotHighEnoughLimits();
            _useMinterLimits(msg.sender, transfer.amount);

            if (transfer.unwrap && allowTokenUnwrapping) {
                _unwrapAndMint(transfer.recipient, transfer.amount);
            } else {
                _mint(transfer.recipient, transfer.amount);
            }
            emit TransferExecuted(transfer.transferId);
        } else {
            // Msg.sender needs to be a multibridge adapter
            if (!multiBridgeAdapters[msg.sender]) revert Controller_AdapterNotSupported();
            if (deliveredBy[transfer.transferId][msg.sender] == true) revert Controller_TransferResentByAadapter();
            deliveredBy[transfer.transferId][msg.sender] = true;

            ReceivedTransfer memory receivedTransfer = receivedTransfers[transfer.transferId];
            // Multi-bridge transfer
            if (receivedTransfer.receivedSoFar == 0) {
                receivedTransfer = ReceivedTransfer({
                    recipient: transfer.recipient,
                    amount: transfer.amount,
                    unwrap: transfer.unwrap,
                    receivedSoFar: 1,
                    threshold: transfer.threshold,
                    originChainId: originChain,
                    executed: false
                });
            } else {
                receivedTransfer.receivedSoFar++;
            }
            // Check if the transfer can be executed
            if (receivedTransfer.receivedSoFar >= receivedTransfer.threshold) {
                emit TransferExecutable(transfer.transferId);
            }
            receivedTransfers[transfer.transferId] = receivedTransfer;
        }
        emit TransferReceived(transfer.transferId, originChain, msg.sender);
    }

    /**
     * @notice Executes a received multibridge transfer. Anyone can execute a transfer
     * @param transferId The unique identifier of the transfer.
     */
    function execute(bytes32 transferId) public nonReentrant whenNotPaused {
        ReceivedTransfer storage transfer = receivedTransfers[transferId];
        if (transfer.amount == 0) revert Controller_UnknownTransfer();
        if (transfer.executed) revert Controller_TransferNotExecutable();
        if (transfer.receivedSoFar < transfer.threshold) revert Controller_ThresholdNotMet();
        uint256 _currentLimit = mintingCurrentLimitOf(address(0));
        if (_currentLimit < transfer.amount) revert Controller_NotHighEnoughLimits();
        _useMinterLimits(address(0), transfer.amount);
        transfer.executed = true;

        if (transfer.unwrap && allowTokenUnwrapping) {
            _unwrapAndMint(transfer.recipient, transfer.amount);
        } else {
            _mint(transfer.recipient, transfer.amount);
        }

        emit TransferExecuted(transferId);
    }

    /* ========== VIEW ========== */

    /**
     * @notice Returns the controller address for a given chain ID.
     * @param chainId The chain ID.
     * @return The controller address.
     */
    function getControllerForChain(uint256 chainId) public view override returns (address) {
        return _controllerForChain[chainId];
    }

    /**
     * @notice Calculates the transfer ID based on the provided parameters.
     * @param destChainId The destination chain ID.
     * @return The calculated transfer ID.
     */
    function calculateTransferId(uint256 destChainId) public view returns (bytes32) {
        return keccak256(abi.encode(destChainId, block.chainid, nonce));
    }

    /* ========== ADMIN ========== */

    function setTokenUnwrapping(bool _allowUnwrapping) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        allowTokenUnwrapping = _allowUnwrapping;
        emit AllowTokenUnwrappingSet(_allowUnwrapping);
    }

    /**
     * @notice Sets the controller addresses for the given chain IDs.
     * @dev This also serves -in a way- as the token mappers for the token according to xERC20
     * @param chainId The list of chain IDs.
     * @param controller The list of controller addresses.
     */
    function setControllerForChain(uint256[] memory chainId, address[] memory controller) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _setControllerForChain(chainId, controller);
    }

    /**
     * @notice Pauses or unpauses the initiation of new transfers to a specific chain.
     * @dev Only the owner can call this function.
     * @param _chainId The chain ID to pause or unpause transfers to.
     * @param _pause True to pause transfers, false to unpause.
     */
    function pauseTransfersToChain(uint256 _chainId, bool _pause) public onlyRole(DEFAULT_ADMIN_ROLE) {
        transfersPausedTo[_chainId] = _pause;
        emit TransfersPausedToChain(_chainId, _pause);
    }

    /**
     * @notice Sets the minimum number of bridges required to relay an asset for multi-bridge transfers.
     * @dev Setting to 0 will disable multi-bridge transfers.
     * @param _minBridges The minimum number of bridges required.
     */
    function setMinBridges(uint256 _minBridges) public onlyRole(DEFAULT_ADMIN_ROLE) {
        minBridges = _minBridges;
        emit MinBridgesSet(_minBridges);
    }

    /**
     * @notice Adds a bridge adapter to the whitelist for multibridge transfers.
     * @dev adapter and enabledmust have the same length.
     * @param adapter An array of adapter addresses of the bridge adapters.
     * @param enabled An array of the status of the adapters. True to enable, false to disable.
     */
    function setMultiBridgeAdapters(address[] memory adapter, bool[] memory enabled) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter.length != enabled.length) revert Controller_Invalid_Params();
        for (uint256 i = 0; i < adapter.length; i++) {
            multiBridgeAdapters[adapter[i]] = enabled[i];
            emit MultiBridgeAdapterSet(adapter[i], enabled[i]);
        }
    }

    /**
     *@notice Withdraws the contract balance to the recipient address.
     * @dev Only the owner can call this function.
     * @param recipient The address to which the contract balance will be transferred.
     */
    function withdraw(address payable recipient) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert Controller_Invalid_Params();

        (bool success, ) = recipient.call{value: address(this).balance}("");
        if (!success) revert Controller_EtherTransferFailed();
    }

    /* ========== INTERNAL ========== */

    /**
     * @notice Mints the asset to the recipient address, using the MINT_SELECTOR.
     * @param recipient The address of the recipient.
     * @param amount The amount of the asset to mint.
     */
    function _mint(address recipient, uint256 amount) internal virtual {
        (bool success, ) = token.call(abi.encodeWithSelector(MINT_SELECTOR, recipient, amount));
        if (!success) revert Controller_TokenMintFailed();
    }

    /**
     * @notice Burns the asset from the account address, using the burnSelector.
     * @param account The address of the account to burn from.
     * @param amount The amount of the asset to burn.
     */
    function _burn(address account, uint256 amount) internal virtual {
        uint256 balance = IERC20(token).balanceOf(account);
        bool success;
        if (BURN_SELECTOR == BURN_SELECTOR_SINGLE) {
            // burn(uint256) implementations expect msg.sender to hold the tokens
            IERC20(token).transferFrom(account, address(this), amount);
            (success, ) = token.call(abi.encodeWithSelector(BURN_SELECTOR, amount));
        } else {
            (success, ) = token.call(abi.encodeWithSelector(BURN_SELECTOR, account, amount));
        }
        uint256 newBalance = IERC20(token).balanceOf(account);
        if (!success || (newBalance != balance - amount)) revert Controller_TokenBurnFailed();
    }

    /**
     * @notice Relays a message to another chain.
     * @notice Msg.sender will receive any refunds from excess fees paid by the bridge, if the bridge supports it.
     * @param transfer The Transfer struct with the transfer data.
     * @param destChainId The destination chain ID.
     * @param adapters The list of adapter addresses.
     * @param fees The list of fees for each adapter.
     * @param totalFees The msg.value passed to the function that should cover the sum of all the fees. Will revert if sum of fees is not equal to totalFees.
     */
    function _relayTransfer(
        Transfer memory transfer,
        uint256 destChainId,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] memory options,
        uint256 totalFees
    ) internal {
        if ((adapters.length != fees.length) || (adapters.length != options.length)) revert Controller_Invalid_Params();
        uint256 fee;
        for (uint256 i = 0; i < adapters.length; i++) {
            // Check that provided bridges are whitelisted
            if (multiBridgeAdapters[adapters[i]] == false) revert Controller_AdapterNotSupported();
            IBaseAdapter(adapters[i]).relayMessage{value: fees[i]}(destChainId, getControllerForChain(destChainId), options[i], abi.encode(transfer));
            emit TransferRelayed(transfer.transferId, adapters[i]);
            fee += fees[i];
        }
        if (fee != totalFees) revert Controller_FeesSumMismatch();
    }

    /**
     * @notice Sets the controller addresses for the given chain IDs.
     * @param chainId The list of chain IDs.
     * @param controller The list of controller addresses.
     */
    function _setControllerForChain(uint256[] memory chainId, address[] memory controller) internal {
        if (chainId.length != controller.length) revert Controller_Invalid_Params();
        for (uint256 i = 0; i < chainId.length; i++) {
            _controllerForChain[chainId[i]] = controller[i];
            emit ControllerForChainSet(controller[i], chainId[i]);
        }
    }

    /**
     * @notice If there is a XERC20Lockbox set in the token, unwrap the asset and send it to the recipient. If not, mint the tokens directly.
     * @dev Checks that all external calls will succeed, otherwise it returns the tokens to the user.
     * @param recipient The address of the recipient.
     * @param amount The amount of the asset to unwrap and mint.
     */
    function _unwrapAndMint(address recipient, uint256 amount) internal virtual {
        // Try to get the lockbox address from the token
        (bool success, bytes memory data) = token.call(abi.encodeWithSignature("lockbox()"));

        // Check if lockbox call was successful and returned data
        if (success && data.length != 0) {
            address lockbox = abi.decode(data, (address));

            // Only attempt unwrapping if lockbox exists
            if (lockbox != address(0)) {
                // Store initial balance to calculate exact amount after minting
                uint256 balanceBefore = IERC20(token).balanceOf(address(this));

                // Mint tokens to this contract
                _mint(address(this), amount);

                // Calculate exact amount received (accounts for potential taxes/fees)
                uint256 amountToUnwrap = IERC20(token).balanceOf(address(this)) - balanceBefore;

                // Get the underlying token address from lockbox
                (bool addrRetrSuccess, bytes memory underlying) = lockbox.call(abi.encodeWithSignature("ERC20()"));

                // Approve tokens for unwrapping
                (success, ) = token.call(abi.encodeWithSignature("approve(address,uint256)", lockbox, amountToUnwrap));

                // If approval failed or underlying token retrieval failed or allowance is insufficient
                if (!success || !addrRetrSuccess || IERC20(token).allowance(address(this), lockbox) < amountToUnwrap) {
                    // Transfer tokens directly to recipient without unwrapping
                    IERC20(token).transfer(recipient, amountToUnwrap);
                    return;
                }

                // Decode underlying token address
                address underlyingToken = abi.decode(underlying, (address));

                // If underlying token is address(0), can't unwrap
                if (underlyingToken == address(0)) {
                    IERC20(token).transfer(recipient, amountToUnwrap);
                    return;
                }

                // Try to withdraw/unwrap tokens
                (success, ) = lockbox.call(abi.encodeWithSignature("withdraw(uint256)", amountToUnwrap));

                // If withdrawal failed, send the wrapped tokens directly
                if (!success) {
                    IERC20(token).transfer(recipient, amountToUnwrap);
                    return;
                }

                // Transfer unwrapped/underlying tokens to recipient
                IERC20(underlyingToken).transfer(recipient, amountToUnwrap);
                return;
            }
        }

        // If lockbox doesn't exist or can't be used, mint tokens directly to recipient
        _mint(recipient, amount);
    }

    /// @dev Execution will revert if there is a duplicate adapter in the array
    function _checkUniqueness(address[] memory adapters) internal pure {
        uint256 length = adapters.length;
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = i + 1; j < length; j++) {
                // Verify that the adapter is not a duplicate
                if (adapters[i] == adapters[j]) revert Controller_DuplicateAdapter();
            }
        }
    }

    ///@dev Fallback function to receive ether from bridge refunds
    receive() external payable {}
}
