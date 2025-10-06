// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IAssetController} from "../interfaces/IAssetController.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20, IERC20, IERC20Permit} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ControllerWrapper is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ===== Events =====
    event TransferSent(
        address indexed sender,
        address indexed controller,
        bool resent,
        bool multi,
        uint256 grossAmount,
        uint256 netAmount,
        bytes data
    );
    event FeesCollected(address indexed payer, address indexed token, address indexed controller, uint256 feeAmount, address treasury);
    event FeeRateSet(uint256 oldRate, uint256 newRate);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event ControllerWhitelisted(address indexed controller, bool whitelisted);
    event ControllerFeeTiersSet(address indexed controller, uint256 indexed destChainId, uint256[] thresholds, uint256[] rates);
    event DestChainPremiumSet(uint256 indexed destChainId, uint256 rate);

    // ===== Errors =====
    error Wrapper_ControllerNotWhitelisted();
    error Wrapper_LengthMismatch();
    error Wrapper_InvalidParams();
    error Wrapper_InvalidFeeRate();
    error Wrapper_TreasuryZeroAddress();
    error Wrapper_ZeroAddress();
    error Wrapper_FeeOnTransferTokenNotSupported();
    error Wrapper_TransferFailed();
    error Wrapper_Unauthorized();

    struct PermitData {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct DepositInput {
        address controller;
        address recipient;
        uint256 amount;
        bool unwrap;
        uint256 destChainId;
    }

    // ===== Tiered Fee Mechanism =====
    struct FeeTier {
        uint256 threshold; // minimum amount for this tier (inclusive)
        uint256 rate; // fee rate for this tier
    }
    // Up to 3 tiers per (controller, destChainId)
    struct FeeTierConfig {
        FeeTier[3] tiers; // sorted ascending by threshold
        uint8 count; // number of active tiers (0-3)
    }

    // ===== Storage =====
    bytes32 public constant CONTROLLER_MANAGER_ROLE = keccak256("CONTROLLER_MANAGER_ROLE");

    uint256 public constant RATE_DENOMINATOR = 100_000; // 100.00%
    uint256 public constant MAX_FEE_RATE = 5_000; // 5.00%

    uint256 public feeRate; // global base rate
    address public treasury; // fee recipient

    mapping(address => bool) public controllers; // whitelist

    // controller => destChainId => FeeTierConfig
    mapping(address => mapping(uint256 => FeeTierConfig)) private _controllerFeeTiers;

    // Per-destination premium added on top of base (then clamped)
    mapping(uint256 => uint256) public destChainPremiumRate; // per-destination premium rate

    constructor(
        address[2] memory access, // admin, controller manager
        address _treasury,
        uint256 _feeRate,
        address[] memory initialControllers,
        uint256[] memory premiumChainIds,
        uint256[] memory premiumRate
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, access[0]);
        _grantRole(CONTROLLER_MANAGER_ROLE, access[1]);

        // Treasury + global rate
        if (_treasury == address(0) && _feeRate > 0) revert Wrapper_TreasuryZeroAddress();
        if (_feeRate > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
        treasury = _treasury;
        feeRate = _feeRate;
        emit TreasurySet(address(0), _treasury);
        emit FeeRateSet(0, _feeRate);

        // Whitelist
        for (uint256 i = 0; i < initialControllers.length; i++) {
            controllers[initialControllers[i]] = true;
            emit ControllerWhitelisted(initialControllers[i], true);
        }

        // No tiered fee configuration in constructor. Use setControllerFeeTiers after deployment if needed.

        // Destination premiums
        if (premiumChainIds.length != premiumRate.length) revert Wrapper_LengthMismatch();
        for (uint256 i = 0; i < premiumChainIds.length; i++) {
            if (premiumRate[i] > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
            destChainPremiumRate[premiumChainIds[i]] = premiumRate[i];
            emit DestChainPremiumSet(premiumChainIds[i], premiumRate[i]);
        }
    }

    /// @dev limits the function callers to `admin` or `controller manager`
    modifier adminOrManager() {
        if (!(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(CONTROLLER_MANAGER_ROLE, msg.sender))) {
            revert Wrapper_Unauthorized();
        }
        _;
    }

    // ===== External =====
    function transferTo(
        DepositInput calldata input,
        address adapter,
        bytes calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        (address token, uint256 net) = _process(input.controller, input.amount, input.destChainId);
        IAssetController(input.controller).transferTo{value: msg.value}(
            input.recipient,
            net,
            input.unwrap,
            input.destChainId,
            adapter,
            bridgeOptions
        );
        IERC20(token).forceApprove(input.controller, 0);
        emit TransferSent(msg.sender, input.controller, false, false, input.amount, net, data);
    }

    function transferToWPermit(
        DepositInput calldata input,
        PermitData calldata permit,
        address adapter,
        bytes calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        (address token, uint256 net) = _processPermit(input.controller, input.amount, input.destChainId, permit);
        IAssetController(input.controller).transferTo{value: msg.value}(
            input.recipient,
            net,
            input.unwrap,
            input.destChainId,
            adapter,
            bridgeOptions
        );
        IERC20(token).forceApprove(input.controller, 0);
        emit TransferSent(msg.sender, input.controller, false, false, input.amount, net, data);
    }

    function transferTo(
        DepositInput calldata input,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        (address token, uint256 net) = _process(input.controller, input.amount, input.destChainId);
        IAssetController(input.controller).transferTo{value: msg.value}(
            input.recipient,
            net,
            input.unwrap,
            input.destChainId,
            adapters,
            fees,
            bridgeOptions
        );
        IERC20(token).forceApprove(input.controller, 0);
        emit TransferSent(msg.sender, input.controller, false, true, input.amount, net, data);
    }

    function transferToWPermit(
        DepositInput calldata input,
        PermitData calldata permit,
        address[] memory adapters,
        uint256[] memory fees,
        bytes[] calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        (address token, uint256 net) = _processPermit(input.controller, input.amount, input.destChainId, permit);
        IAssetController(input.controller).transferTo{value: msg.value}(
            input.recipient,
            net,
            input.unwrap,
            input.destChainId,
            adapters,
            fees,
            bridgeOptions
        );
        IERC20(token).forceApprove(input.controller, 0);
        emit TransferSent(msg.sender, input.controller, false, true, input.amount, net, data);
    }

    function resendTransfer(
        address controller,
        bytes32 transferId,
        address adapter,
        bytes calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        if (!controllers[controller]) revert Wrapper_ControllerNotWhitelisted();
        IAssetController(controller).resendTransfer{value: msg.value}(transferId, adapter, bridgeOptions);
        emit TransferSent(msg.sender, controller, true, false, 0, 0, data);
    }

    function resendTransfer(
        address controller,
        bytes32 transferId,
        address[] calldata adapters,
        uint256[] calldata fees,
        bytes[] calldata bridgeOptions,
        bytes calldata data
    ) external payable nonReentrant whenNotPaused {
        if (!controllers[controller]) revert Wrapper_ControllerNotWhitelisted();
        IAssetController(controller).resendTransfer{value: msg.value}(transferId, adapters, fees, bridgeOptions);
        emit TransferSent(msg.sender, controller, true, true, 0, 0, data);
    }

    // ===== Admin =====
    function setControllers(address[] calldata controller, bool[] calldata whitelisted) external adminOrManager {
        if (controller.length != whitelisted.length) revert Wrapper_LengthMismatch();
        for (uint256 i = 0; i < controller.length; i++) {
            controllers[controller[i]] = whitelisted[i];
            emit ControllerWhitelisted(controller[i], whitelisted[i]);
        }
    }

    function setFeeRate(uint256 newFeeRate) external adminOrManager {
        if (newFeeRate > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
        if (newFeeRate > 0 && treasury == address(0)) revert Wrapper_TreasuryZeroAddress();
        emit FeeRateSet(feeRate, newFeeRate);
        feeRate = newFeeRate;
    }

    /**
     * @notice Set tiered fee configuration for a controller and multiple destination chains. The same tiered fee is applied to all specified destination chains.
     * @param controller The address of the controller.
     * @param destChainIds The IDs of the destination chains.
     * @param thresholds The thresholds for each fee tier.
     * @param bips The fee bips for each tier.
     */
    function setControllerFeeTiers(
        address controller,
        uint256[] calldata destChainIds,
        uint256[] calldata thresholds,
        uint256[] calldata bips
    ) external adminOrManager {
        if (thresholds.length != bips.length || thresholds.length > 3) revert Wrapper_LengthMismatch();
        for (uint256 i = 0; i < destChainIds.length; i++) {
            _setControllerFeeTiers(controller, destChainIds[i], thresholds, bips);
        }
    }

    function _setControllerFeeTiers(address controller_, uint256 destChainId, uint256[] memory thresholds, uint256[] memory bips) internal {
        FeeTierConfig storage config = _controllerFeeTiers[controller_][destChainId];
        // Clear existing tiers
        for (uint8 i = 0; i < 3; i++) {
            config.tiers[i] = FeeTier(0, 0);
        }
        uint256 items = thresholds.length;

        if (items > 0) {
            for (uint8 i = 0; i < items; i++) {
                // Ensure basis points are within valid range
                if (bips[i] > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
                // Ensure threshold is not zero (except first tier)
                if (i > 0 && thresholds[i] == 0) revert Wrapper_InvalidParams();
                // Ensure thresholds are in strictly ascending order
                if (i > 0 && thresholds[i] <= thresholds[i - 1]) revert Wrapper_InvalidParams();

                config.tiers[i] = FeeTier(thresholds[i], bips[i]);
            }
        }
        config.count = uint8(items);
        emit ControllerFeeTiersSet(controller_, destChainId, thresholds, bips);
    }

    /**
     * @notice Set premium fee rates for specific destination chains. Each rate corresponds to the chain ID at the same index.
     * @param chainIds The IDs of the destination chains.
     * @param rates The premium fee rates for each chain.
     */
    function setDestChainPremiumRate(uint256[] calldata chainIds, uint256[] calldata rates) external adminOrManager {
        if (chainIds.length != rates.length) revert Wrapper_LengthMismatch();
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (rates[i] > MAX_FEE_RATE) revert Wrapper_InvalidFeeRate();
            destChainPremiumRate[chainIds[i]] = rates[i];
            emit DestChainPremiumSet(chainIds[i], rates[i]);
        }
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert Wrapper_TreasuryZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueETH(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Wrapper_ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert Wrapper_TransferFailed();
    }

    // ===== Views =====
    function getControllerFeeTiers(
        address controller,
        uint256 destChainId
    ) external view returns (uint256[] memory thresholds, uint256[] memory bips) {
        FeeTierConfig memory config = _controllerFeeTiers[controller][destChainId];
        thresholds = new uint256[](config.count);
        bips = new uint256[](config.count);
        for (uint8 i = 0; i < config.count; i++) {
            thresholds[i] = config.tiers[i].threshold;
            bips[i] = config.tiers[i].rate;
        }
        return (thresholds, bips);
    }

    /// @notice Quote the fee and net given amount/controller/destChain.
    function quote(address controller, uint256 destChainId, uint256 amount) external view returns (uint256 fee, uint256 net) {
        (fee, net) = _quoteFee(controller, destChainId, amount);
    }

    // ===== Internal helpers =====
    /**
     * @notice Internal function to calculate the fee and net amount for a given controller, destChainId, and amount.
     * Implements tiered fee logic similar to LTokenUpgradeable, with fallback to global feeRate and addition of destChainPremiumRates.
     * @param controller The controller address
     * @param destChainId The destination chain ID
     * @param amount The gross amount
     * @return fee The total fee to be collected
     * @return net The net amount after fee
     */
    function _quoteFee(address controller, uint256 destChainId, uint256 amount) internal view returns (uint256 fee, uint256 net) {
        FeeTierConfig memory config = _controllerFeeTiers[controller][destChainId];
        uint256 baseFee = 0;
        if (config.count > 0 && amount > 0) {
            // Tiered fee calculation
            uint256 remaining = amount;
            uint256 processed = 0;
            uint256 tierStart = 0;
            for (uint8 i = 0; i < config.count; i++) {
                uint256 threshold = config.tiers[i].threshold;
                uint256 rate = config.tiers[i].rate;
                uint256 tierAmount;
                if (i == config.count - 1) {
                    // Last tier: everything above previous threshold
                    tierAmount = remaining;
                } else if (remaining > threshold - tierStart) {
                    tierAmount = threshold - tierStart;
                } else {
                    tierAmount = remaining;
                }
                if (tierAmount > 0) {
                    baseFee += (tierAmount * rate) / RATE_DENOMINATOR;
                    processed += tierAmount;
                    remaining -= tierAmount;
                }
                tierStart = threshold;
                if (remaining == 0) break;
            }
        } else if (feeRate > 0 && amount > 0) {
            // Fallback to global feeRate
            baseFee = (amount * feeRate) / RATE_DENOMINATOR;
        }

        // Add destination chain premium (if any)
        uint256 premiumRate = destChainPremiumRate[destChainId];
        if (premiumRate > 0 && amount > 0) {
            // Premium is applied on the original amount, then added to baseFee
            baseFee += (amount * premiumRate) / RATE_DENOMINATOR;
        }

        fee = baseFee;
        net = amount - fee;
    }

    function _process(address controller, uint256 amount, uint256 destChainId) internal returns (address token, uint256 netAmount) {
        if (!controllers[controller]) revert Wrapper_ControllerNotWhitelisted();
        token = IAssetController(controller).token();
        netAmount = _handleTransfers(token, controller, amount, destChainId);
    }

    function _processPermit(
        address controller,
        uint256 amount,
        uint256 destChainId,
        PermitData calldata permit
    ) internal returns (address token, uint256 netAmount) {
        if (!controllers[controller]) revert Wrapper_ControllerNotWhitelisted();
        token = IAssetController(controller).token();

        IERC20Permit(token).permit(msg.sender, address(this), amount, permit.deadline, permit.v, permit.r, permit.s);

        netAmount = _handleTransfers(token, controller, amount, destChainId);
    }

    function _handleTransfers(address token, address controller, uint256 amount, uint256 destChainId) internal returns (uint256 netAmount) {
        IERC20 t = IERC20(token);

        // Pull exactly `amount` and disallow fee-on-transfer tokens
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received != amount) revert Wrapper_FeeOnTransferTokenNotSupported();

        (uint256 fee, uint256 net) = _quoteFee(controller, destChainId, amount);

        if (fee > 0) {
            if (treasury == address(0)) revert Wrapper_TreasuryZeroAddress();
            t.safeTransfer(treasury, fee);
            emit FeesCollected(msg.sender, token, controller, fee, treasury);
        }

        t.forceApprove(controller, net);
        return net;
    }

    receive() external payable {}
}
