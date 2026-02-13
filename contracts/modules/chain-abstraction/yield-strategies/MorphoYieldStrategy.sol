// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {IYieldStrategy} from "./interfaces/IYieldStrategy.sol";
import {IERC4626, IERC20, IERC20Metadata} from "./interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title MorphoYieldStrategy
 * @notice Yield strategy implementation for Morpho Vaults V1 or V2
 * @dev This contract holds share tokens and manages deposits/withdrawals to a Morpho Vault
 */
contract MorphoYieldStrategy is Initializable, IYieldStrategy, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Events ============

    event Deposited(uint256 amount, uint256 newPrincipal);
    event PrincipalWithdrawn(uint256 amount, uint256 remainingPrincipal);
    event YieldWithdrawn(uint256 amount, address indexed recipient);
    event Executed(address indexed target, uint256 value, bytes data, bytes returnData);

    // ============ Errors ============

    error Strategy_OnlyController();
    error Strategy_InsufficientPrincipal();
    error Strategy_InsufficientYield();
    error Strategy_ZeroAddress();
    error Strategy_ZeroAmount();
    error Strategy_DepositFailed();
    error Strategy_CallFailed();
    error Strategy_TransferFailed();
    error Strategy_DeadDepositMissing();

    // ============ Constants ============

    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant DEAD_SHARES_MIN = 1_000_000_000;
    uint256 private constant DEAD_SHARES_MIN_LOW_DECIMALS = 1_000_000_000_000;

    // ============ State Variables ============

    /// @notice The underlying asset
    IERC20 public underlyingAsset;

    /// @notice The vault that holds the underlying asset
    IERC4626 public vault;

    /// @notice The AssetController that owns this strategy
    address public controller;

    /// @notice Tracks the principal deposited (excluding yield)
    uint256 private _principalDeposited;

    /// @notice Flag to track if the dead deposit has been verified
    bool private _deadDepositVerified;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @notice Initializes the upgradeable contract
     * @param _vault The vault address
     * @param _underlyingAsset The underlying token address
     * @param _assetController The AssetController address that will use this strategy
     * @param _admin The admin address for yield management
     */
    function initialize(address _vault, address _underlyingAsset, address _assetController, address _admin) external initializer {
        if (_vault == address(0) || _underlyingAsset == address(0) || _assetController == address(0) || _admin == address(0)) {
            revert Strategy_ZeroAddress();
        }

        __AccessControl_init();
        __ReentrancyGuard_init();

        vault = IERC4626(_vault);
        underlyingAsset = IERC20(_underlyingAsset);
        controller = _assetController;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Modifiers ============

    modifier onlyController() {
        if (msg.sender != controller) revert Strategy_OnlyController();
        _;
    }

    // ============ External Functions ============

    /**
     * @notice Deposits funds into the vault
     * @dev Only callable by the AssetController
     * @param amount The amount to deposit
     */
    function deposit(uint256 amount) external override onlyController nonReentrant {
        if (amount == 0) revert Strategy_ZeroAmount();
        if (!_deadDepositVerified) _verifyDeadDeposit();

        // Transfer tokens from controller to this contract
        underlyingAsset.safeTransferFrom(msg.sender, address(this), amount);

        // Approve Vault to spend tokens
        underlyingAsset.forceApprove(address(vault), amount);

        // Supply to Vault
        uint256 sharesBefore = vault.balanceOf(address(this));
        uint256 sharesMinted = vault.deposit(amount, address(this));
        uint256 sharesAfter = vault.balanceOf(address(this));
        if ((sharesBefore + sharesMinted) < sharesAfter) revert Strategy_DepositFailed();
        // Update principal tracking
        _principalDeposited += amount;

        emit Deposited(amount, _principalDeposited);
    }

    /**
     * @notice Withdraws principal from the Vault back to the controller
     * @dev Only callable by the AssetController. Cannot withdraw more than deposited principal.
     * @param amount The amount of principal to withdraw
     * @return The amount withdrawn
     */
    function withdraw(uint256 amount) external override onlyController nonReentrant returns (uint256) {
        if (amount == 0) revert Strategy_ZeroAmount();
        if (amount > _principalDeposited) revert Strategy_InsufficientPrincipal();

        // Withdraw from Vault directly to the controller
        vault.withdraw(amount, controller, address(this));

        // Update principal tracking
        _principalDeposited -= amount;

        emit PrincipalWithdrawn(amount, _principalDeposited);
        return amount;
    }

    /**
     * @notice Withdraws only the yield to a specified recipient
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param recipient The address to receive the yield
     * @return withdrawn The amount of yield withdrawn
     */
    function withdrawYield(address recipient) external override onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 withdrawn) {
        if (recipient == address(0)) revert Strategy_ZeroAddress();

        uint256 currentYield = getYield();
        if (currentYield == 0) revert Strategy_InsufficientYield();
        // If no principal, withdraw all
        if (_principalDeposited == 0) {
            withdrawn = vault.redeem(vault.balanceOf(address(this)), recipient, address(this));
        } else {
            vault.withdraw(currentYield, recipient, address(this));
            withdrawn = currentYield;
        }

        emit YieldWithdrawn(withdrawn, recipient);
    }

    /**
     * @notice Executes an arbitrary call from this contract
     * @dev Only callable by DEFAULT_ADMIN_ROLE. Uses only msg.value sent with transaction.
     * @param target The contract address to call
     * @param data The calldata to forward
     * @return result The raw returned data from the call
     */
    function execute(address target, bytes calldata data) external payable onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (bytes memory result) {
        if (target == address(0)) revert Strategy_ZeroAddress();

        (bool success, bytes memory returnData) = target.call{value: msg.value}(data);

        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(32, returnData), mload(returnData))
                }
            }
            revert Strategy_CallFailed();
        }

        emit Executed(target, msg.value, data, returnData);
        return returnData;
    }

    /**
     * @notice Allows the admin to rescue tokens from the contract.
     * @param token The address of the token to rescue.
     * @param to The address to send the rescued tokens to.
     * @param amount The amount of tokens to rescue.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Strategy_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Allows the admin to rescue ETH from the contract.
     * @param to The address to send the rescued ETH to.
     * @param amount The amount of ETH to rescue.
     */
    function rescueETH(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Strategy_ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert Strategy_TransferFailed();
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
     * @dev Calculates total balance based on current shares held and the vault's conversion rate
     * @return The total balance
     */
    function getTotalBalance() public view override returns (uint256) {
        uint256 shares = vault.balanceOf(address(this));
        return vault.convertToAssets(shares);
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

    /**
     * @notice Fallback to receive ETH
     */
    receive() external payable {}

    // ============ Internal Functions ============

    function _verifyDeadDeposit() internal {
        uint8 assetDecimals = IERC20Metadata(address(underlyingAsset)).decimals();
        uint256 requiredShares = assetDecimals < 9 ? DEAD_SHARES_MIN_LOW_DECIMALS : DEAD_SHARES_MIN;
        if (vault.balanceOf(DEAD_ADDRESS) < requiredShares) revert Strategy_DeadDepositMissing();
        _deadDepositVerified = true;
    }
}
