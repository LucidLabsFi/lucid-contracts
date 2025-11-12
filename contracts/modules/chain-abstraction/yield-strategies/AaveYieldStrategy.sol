// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IYieldStrategy} from "./interfaces/IYieldStrategy.sol";
import {IAaveV3Pool} from "./interfaces/IAaveV3Pool.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title AaveYieldStrategy
 * @notice Yield strategy implementation for Aave V3
 * @dev This contract holds aTokens and manages deposits/withdrawals to Aave
 */
contract AaveYieldStrategy is Initializable, IYieldStrategy, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Events ============

    event Deposited(uint256 amount, uint256 newPrincipal);
    event PrincipalWithdrawn(uint256 amount, uint256 remainingPrincipal);
    event YieldWithdrawn(uint256 amount, address indexed recipient);
    event EmergencyWithdrawal(uint256 amount);

    // ============ Errors ============

    error Strategy_OnlyController();
    error Strategy_InsufficientPrincipal();
    error Strategy_InsufficientYield();
    error Strategy_ZeroAddress();
    error Strategy_UnderlyingNotSupported();
    error Strategy_ZeroAmount();
    error Strategy_DepositFailed();

    // ============ State Variables ============

    /// @notice The Aave V3 Pool contract
    IAaveV3Pool public aavePool;

    /// @notice The underlying asset
    IERC20 public underlyingAsset;

    /// @notice The Aave aToken received when supplying
    IERC20 public aToken;

    /// @notice The AssetController that owns this strategy
    address public controller;

    /// @notice Tracks the principal deposited (excluding yield)
    uint256 private _principalDeposited;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @notice Initializes the upgradeable contract
     * @param _aavePool The Aave V3 Pool address
     * @param _underlyingAsset The underlying token address
     * @param _assetController The AssetController address that will use this strategy
     * @param _admin The admin address for yield management
     */
    function initialize(address _aavePool, address _underlyingAsset, address _assetController, address _admin) external initializer {
        if (_aavePool == address(0) || _underlyingAsset == address(0) || _assetController == address(0) || _admin == address(0)) {
            revert Strategy_ZeroAddress();
        }

        __AccessControl_init();
        __ReentrancyGuard_init();

        aavePool = IAaveV3Pool(_aavePool);
        underlyingAsset = IERC20(_underlyingAsset);
        controller = _assetController;

        address _aToken = aavePool.getReserveAToken(_underlyingAsset);
        if (_aToken == address(0)) revert Strategy_UnderlyingNotSupported();
        aToken = IERC20(_aToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Modifiers ============

    modifier onlyController() {
        if (msg.sender != controller) revert Strategy_OnlyController();
        _;
    }

    // ============ External Functions ============

    /**
     * @notice Deposits funds into Aave
     * @dev Only callable by the AssetController
     * @param amount The amount to deposit
     */
    function deposit(uint256 amount) external override onlyController nonReentrant {
        if (amount == 0) revert Strategy_ZeroAmount();

        // Transfer tokens from controller to this contract
        underlyingAsset.safeTransferFrom(msg.sender, address(this), amount);

        // Approve Aave pool to spend tokens
        underlyingAsset.forceApprove(address(aavePool), amount);

        // Supply to Aave - aTokens are minted to this contract
        uint256 balanceBefore = aToken.balanceOf(address(this));
        aavePool.supply(address(underlyingAsset), amount, address(this), 0);
        uint256 balanceAfter = aToken.balanceOf(address(this));
        if ((balanceBefore + amount) < balanceAfter) revert Strategy_DepositFailed();
        // Update principal tracking
        _principalDeposited += amount;

        emit Deposited(amount, _principalDeposited);
    }

    /**
     * @notice Withdraws principal from Aave back to the controller
     * @dev Only callable by the AssetController. Cannot withdraw more than deposited principal.
     * @param amount The amount of principal to withdraw
     * @return withdrawn The amount withdrawn
     */
    function withdraw(uint256 amount) external override onlyController nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert Strategy_ZeroAmount();
        if (amount > _principalDeposited) revert Strategy_InsufficientPrincipal();

        // Withdraw from Aave directly to the controller
        withdrawn = aavePool.withdraw(address(underlyingAsset), amount, controller);

        // Update principal tracking
        _principalDeposited -= withdrawn;

        emit PrincipalWithdrawn(withdrawn, _principalDeposited);
        return withdrawn;
    }

    /**
     * @notice Withdraws only the yield to a specified recipient
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param recipient The address to receive the yield
     * @return The amount of yield withdrawn
     */
    function withdrawYield(address recipient) external override onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256) {
        if (recipient == address(0)) revert Strategy_ZeroAddress();

        uint256 currentYield = getYield();
        if (currentYield == 0) revert Strategy_InsufficientYield();
        // If no principal, withdraw all
        if (_principalDeposited == 0) currentYield = type(uint256).max;

        // Withdraw yield from Aave to recipient
        uint256 withdrawn = aavePool.withdraw(address(underlyingAsset), currentYield, recipient);

        emit YieldWithdrawn(withdrawn, recipient);
        return withdrawn;
    }

    // ============ View Functions ============

    /**
     * @notice Returns the principal deposited (excluding yield)
     * @return The principal amount
     */
    function getPrincipal() external view override returns (uint256) {
        return _principalDeposited;
    }

    /**
     * @notice Returns the total balance including principal and accrued yield
     * @dev aToken balance automatically includes accrued interest
     * @return The total balance
     */
    function getTotalBalance() public view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /**
     * @notice Returns the currently accumulated yield
     * @return The yield amount (total balance - principal)
     */
    function getYield() public view override returns (uint256) {
        uint256 totalBalance = getTotalBalance();
        return totalBalance > _principalDeposited ? totalBalance - _principalDeposited : 0;
    }

    /**
     * @notice Returns the underlying asset address
     * @return The asset address
     */
    function asset() external view override returns (address) {
        return address(underlyingAsset);
    }
}
