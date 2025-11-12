// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {AssetController, SafeERC20, IERC20} from "./AssetController.sol";
import {IYieldStrategy} from "./yield-strategies/interfaces/IYieldStrategy.sol";

/**
 * @title LockReleaseAssetController
 * @notice An implementation of the AssetController but instead of burning/minting tokens, it locks and releases ERC20s.
 */
contract LockReleaseAssetController is AssetController {
    using SafeERC20 for IERC20;

    /// @notice Event emitted when liquidity is added
    /// @param amount The amount of tokens added to the pool
    event LiquidityAdded(uint256 amount);

    /// @notice Event emitted when liquidity is removed
    /// @param amount The amount of tokens removed from the pool
    event LiquidityRemoved(uint256 amount);

    /// @notice Event emitted when the yield strategy is set
    /// @param oldStrategy The address of the old yield strategy
    /// @param newStrategy The address of the new yield strategy
    event YieldStrategySet(address indexed oldStrategy, address indexed newStrategy);

    /// @notice Event emitted when funds are deployed to the yield strategy
    /// @param amount The amount of tokens deployed to the strategy
    event FundsDeployedToStrategy(uint256 amount);

    /// @notice Event emitted when funds are withdrawn from the yield strategy
    /// @param amount The amount of tokens withdrawn from the strategy
    event FundsWithdrawnFromStrategy(uint256 amount);

    /// @notice Error thrown when XERC20 token unwrapping is not supported
    error Controller_UnwrappingNotSupported();

    /// @notice Error thrown when there are not enough tokens in the pool
    error Controller_NotEnoughTokensInPool();

    /// @notice Error thrown when a transfer fails
    error Controller_TransferFailed();

    /// @notice Error thrown when a zero address is encountered
    error Controller_ZeroAddress();

    /// @notice Error thrown when an invalid yield strategy contract is set
    error Controller_InvalidStrategy();

    /// @notice Error thrown when there is insufficient liquidity to fulfill a mint message
    error Controller_InsufficientLiquidity();

    /// @notice The active yield strategy (address(0) means no strategy)
    IYieldStrategy public yieldStrategy;

    /// @notice Role identifier for the account that can manage yield strategies.
    bytes32 public constant YIELD_MANAGER_ROLE = keccak256("YIELD_MANAGER_ROLE");

    /**
     * @notice Initializes the contract with the given parameters.
     * @dev To configure multibridge limits, use the zero address as a bridge in `_bridges` and set the limits accordingly.
     * @param _addresses An array with four elements, containing the token address, the user that gets DEFAULT_ADMIN_ROLE and PAUSE_ROLE, the user getting only PAUSE_ROLE,
     *          the fee collector contract, the controller address in other chains for the given chain IDs (if deployed with create3).
     * @param _duration The duration it takes for the limits to fully replenish.
     * @param _minBridges The minimum number of bridges required to relay an asset for multi-bridge transfers. Setting to 0 will disable multi-bridge transfers.
     * @param _multiBridgeAdapters The addresses of the initial bridge adapters that can be used for multi-bridge transfers, bypassing the limits.
     * @param _chainId The list of chain IDs to set the controller addresses for.
     * @param _bridges The list of bridge adapter addresses that have limits set for minting and burning.
     * @param _mintingLimits The list of minting limits for the bridge adapters. It must correspond to the mint() function of the token, otherwise tokens cannot be minted
     * @param _burningLimits The list of burning limits for the bridge adapters. It must correspond to the burn() function of the token, otherwise tokens cannot be burned
     * @param _selectors Mint and burn function selectors. An empty bytes4 should be passed.
     * @param _yieldStrategy The address of the initial yield strategy to use. Setting to address(0) means no strategy.
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
        bytes4[2] memory _selectors,
        address _yieldStrategy
    ) AssetController(_addresses, _duration, _minBridges, _multiBridgeAdapters, _chainId, _bridges, _mintingLimits, _burningLimits, _selectors) {
        if (_yieldStrategy != address(0)) {
            yieldStrategy = IYieldStrategy(_yieldStrategy);
            if (yieldStrategy.asset() != _addresses[0]) revert Controller_InvalidStrategy();
            emit YieldStrategySet(address(0), _yieldStrategy);
        }
    }

    /**
     * @notice Deposits funds to the yield strategy
     * @dev Only callable by YIELD_MANAGER_ROLE. Strategy must be set.
     * @param amount The amount to deposit
     */
    function deployToStrategy(uint256 amount) external onlyRole(YIELD_MANAGER_ROLE) nonReentrant {
        if (address(yieldStrategy) == address(0)) revert Controller_InvalidStrategy();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert Controller_InsufficientLiquidity();

        // Approve and deposit to strategy
        IERC20(token).forceApprove(address(yieldStrategy), amount);
        yieldStrategy.deposit(amount);

        emit FundsDeployedToStrategy(amount);
    }

    /**
     * @notice Manually withdraw funds from the yield strategy
     * @dev Only callable by YIELD_MANAGER_ROLE
     * @param amount The amount of principal to withdraw
     */
    function withdrawFromStrategy(uint256 amount) external onlyRole(YIELD_MANAGER_ROLE) nonReentrant {
        if (address(yieldStrategy) == address(0)) revert Controller_InvalidStrategy();
        _withdrawFromStrategy(amount);
    }

    /**
     * @notice Manually withdraw the maximum principal from the yield strategy
     * @dev Only callable by YIELD_MANAGER_ROLE
     */
    function withdrawMaxFromStrategy() external onlyRole(YIELD_MANAGER_ROLE) nonReentrant {
        if (address(yieldStrategy) == address(0)) revert Controller_InvalidStrategy();
        uint256 amount = yieldStrategy.getPrincipal();
        _withdrawFromStrategy(amount);
    }

    /**
     * @notice Sets or updates the yield strategy
     * @dev Only callable by DEFAULT_ADMIN_ROLE. Withdraws all principal from old strategy.
     *      Setting to address(0) disables the current strategy.
     * @param newStrategy The new strategy address (or address(0) to disable)
     */
    function setYieldStrategy(address newStrategy) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        address oldStrategy = address(yieldStrategy);

        // Validate new strategy if not disabling
        if (newStrategy != address(0)) {
            if (IYieldStrategy(newStrategy).asset() != token) revert Controller_InvalidStrategy();
        }

        // Withdraw all principal from old strategy if exists
        if (oldStrategy != address(0)) {
            uint256 amount = yieldStrategy.getPrincipal();
            if (amount > 0) _withdrawFromStrategy(amount);
        }

        yieldStrategy = IYieldStrategy(newStrategy);
        emit YieldStrategySet(oldStrategy, newStrategy);
    }

    /**
     * @notice Overrides the setTokenUnwrapping function to revert, as unwrapping is not supported in this implementation.
     */
    function setTokenUnwrapping(bool) public view override onlyRole(DEFAULT_ADMIN_ROLE) {
        revert Controller_UnwrappingNotSupported();
    }

    /**
     * @notice Allows the admin to rescue tokens stuck in the contract.
     * @param token The address of the token to rescue.
     * @param to The address to send the rescued tokens to.
     * @param amount The amount of tokens to rescue.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Controller_ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Allows the admin to rescue ETH stuck in the contract.
     * @param to The address to send the rescued ETH to.
     * @param amount The amount of ETH to rescue.
     */
    function rescueETH(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert Controller_ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert Controller_TransferFailed();
    }

    /**
     * @notice Returns whether a yield strategy is active
     * @return True if strategy is set
     */
    function hasYieldStrategy() external view returns (bool) {
        return address(yieldStrategy) != address(0);
    }

    /**
     * @notice Returns the total value locked including strategy deposits
     * @return The total TVL
     */
    function getTotalValueLocked() external view returns (uint256) {
        uint256 strategyBalance = address(yieldStrategy) != address(0) ? yieldStrategy.getPrincipal() : 0;
        return strategyBalance + IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Releases the given amount of tokens from the pool.
     * @dev Overwides the default mint implementation to release tokens from the pool.
     * @param _to The address to which the tokens will be sent.
     * @param _amount The amount of tokens to be sent.
     */
    function _mint(address _to, uint256 _amount) internal override {
        IERC20 tokenContract = IERC20(token);
        uint256 availableBalance = tokenContract.balanceOf(address(this));

        // Check if it's needed to withdraw from strategy
        if (availableBalance < _amount) {
            if (address(yieldStrategy) == address(0)) {
                revert Controller_NotEnoughTokensInPool();
            }

            uint256 deficit = _amount - availableBalance;
            uint256 withdrawn = _withdrawFromStrategy(deficit);
            if (withdrawn + availableBalance < _amount) revert Controller_InsufficientLiquidity();
        }

        // Transfer tokens to user
        uint256 balanceBefore = tokenContract.balanceOf(address(this));
        tokenContract.safeTransfer(_to, _amount);
        uint256 balanceAfter = tokenContract.balanceOf(address(this));
        if (balanceBefore - balanceAfter != _amount) revert Controller_TransferFailed();
        emit LiquidityRemoved(_amount);
    }

    /**
     * @notice Locks the given amount of tokens in the pool.
     * @dev Overrides the default burn implementation to lock tokens in the pool.
     * @param _from The address from which the tokens will be taken.
     * @param _amount The amount of tokens to be locked.
     */
    function _burn(address _from, uint256 _amount) internal override {
        IERC20 tokenContract = IERC20(token);

        uint256 balanceBefore = tokenContract.balanceOf(address(this));
        tokenContract.safeTransferFrom(_from, address(this), _amount);
        uint256 balanceAfter = tokenContract.balanceOf(address(this));
        if (balanceAfter - balanceBefore != _amount) revert Controller_TransferFailed();

        emit LiquidityAdded(_amount);
    }

    /**
     * @notice Unwraps and mints the given amount of tokens.
     * @dev Overrides the default unwrapAndMint implementation to mint tokens directly, as there is no unwrap functionality.
     * @param _to The address to which the tokens will be sent.
     * @param _amount The amount of tokens to be sent.
     */
    function _unwrapAndMint(address _to, uint256 _amount) internal override {
        _mint(_to, _amount);
    }

    function _withdrawFromStrategy(uint256 amount) internal returns (uint256 withdrawn) {
        withdrawn = yieldStrategy.withdraw(amount);
        emit FundsWithdrawnFromStrategy(withdrawn);
    }
}
