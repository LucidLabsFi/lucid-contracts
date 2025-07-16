// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {AssetController, SafeERC20, IERC20} from "./AssetController.sol";

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

    /// @notice Error thrown when XERC20 token unwrapping is not supported
    error Controller_UnwrappingNotSupported();

    /// @notice Error thrown when there are not enough tokens in the pool
    error Controller_NotEnoughTokensInPool();

    /// @notice The amount of tokens locked in the pool
    uint256 public lockedTokens;

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
    ) AssetController(_addresses, _duration, _minBridges, _multiBridgeAdapters, _chainId, _bridges, _mintingLimits, _burningLimits, _selectors) {}

    /**
     * @notice Overrides the setTokenUnwrapping function to revert, as unwrapping is not supported in this implementation.
     */
    function setTokenUnwrapping(bool) public view override onlyRole(DEFAULT_ADMIN_ROLE) {
        revert Controller_UnwrappingNotSupported();
    }

    /**
     * @notice Releases the given amount of tokens from the pool.
     * @dev Overwides the default mint implementation to release tokens from the pool.
     * @param _to The address to which the tokens will be sent.
     * @param _amount The amount of tokens to be sent.
     */
    function _mint(address _to, uint256 _amount) internal override {
        if (lockedTokens < _amount) revert Controller_NotEnoughTokensInPool();

        lockedTokens -= _amount;
        IERC20(token).safeTransfer(_to, _amount);
        emit LiquidityRemoved(_amount);
    }

    /**
     * @notice Locks the given amount of tokens in the pool.
     * @dev Overrides the default burn implementation to lock tokens in the pool.
     * @param _from The address from which the tokens will be taken.
     * @param _amount The amount of tokens to be locked.
     */
    function _burn(address _from, uint256 _amount) internal override {
        IERC20(token).safeTransferFrom(_from, address(this), _amount);
        lockedTokens += _amount;
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
}
