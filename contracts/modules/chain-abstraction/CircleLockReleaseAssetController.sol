// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {LockReleaseAssetController} from "./LockReleaseAssetController.sol";
import {IFiatTokenV1} from "./interfaces/IFiatTokenV1.sol";

/**
 * @title CircleLockReleaseAssetController
 * @notice A Circle-specific implementation of the LockReleaseAssetController for Native USDC or EURC.
 */
contract CircleLockReleaseAssetController is LockReleaseAssetController {
    /// @notice Event emitted when the allowed amount of tokens to burn is set.
    event AllowedTokensToBurnSet(uint256 amount);

    /// @notice Error thrown when there are no tokens to burn.
    error Controller_NoTokensToBurn();

    /// @notice Role identifier for the account that can burn locked tokens.
    bytes32 public constant BURN_LOCKED_TOKENS_ROLE = keccak256("BURN_LOCKED_TOKENS_ROLE");

    /// @notice The amount of USDC tokens that can be burned by the burnLockedUSDC function.
    uint256 public allowedTokensToBurn;

    /**
     * @notice Initializes the contract with the given parameters.
     * @notice To configure multibridge limits, use the zero address as a bridge in `_bridges` and set the limits accordingly.
     * @param _addresses An array with five elements, containing the token address, the user that gets DEFAULT_ADMIN_ROLE and PAUSE_ROLE, the user getting only PAUSE_ROLE,
     *          the fee collector contract, the controller address in other chains for the given chain IDs (if deployed with create3).
     * @param _duration The duration it takes for the limits to fully replenish.
     * @param _minBridges The minimum number of bridges required to relay an asset for multi-bridge transfers. Setting to 0 will disable multi-bridge transfers.
     * @param _multiBridgeAdapters The addresses of the initial bridge adapters that can be used for multi-bridge transfers, bypassing the limits.
     * @param _chainId The list of chain IDs to set the controller addresses for.
     * @param _bridges The list of bridge adapter addresses that have limits set for minting and burning.
     * @param _mintingLimits The list of minting limits for the bridge adapters.
     * @param _burningLimits The list of burning limits for the bridge adapters.
     * @param _yieldStrategy The initial yield strategy to use (or address(0) for none).
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
        address _yieldStrategy
    )
        LockReleaseAssetController(
            _addresses,
            _duration,
            _minBridges,
            _multiBridgeAdapters,
            _chainId,
            _bridges,
            _mintingLimits,
            _burningLimits,
            [bytes4(0x40c10f19), BURN_SELECTOR_SINGLE],
            _yieldStrategy
        )
    {}

    /**
     * @notice Sets the amount of tokens that can be burned by the burnLockedUSDC function.
     * @param _amount The amount of USDC to allow for burning.
     */
    function setAllowedTokensToBurn(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedTokensToBurn = _amount;
        emit AllowedTokensToBurnSet(_amount);
    }

    /**
     * @notice Burns the allowed amount of USDC tokens that are locked in the contract.
     * @dev This function can only be called by an account with the BURN_LOCKED_TOKENS_ROLE.
     * @dev It will revert if there are no tokens to burn. If a strategy is set, withdraw the necessary principal first.
     */
    function burnLockedUSDC() external onlyRole(BURN_LOCKED_TOKENS_ROLE) {
        if (allowedTokensToBurn == 0) revert Controller_NoTokensToBurn();
        IFiatTokenV1(token).burn(allowedTokensToBurn);
        allowedTokensToBurn = 0;
    }
}
