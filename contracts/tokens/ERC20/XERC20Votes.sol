// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Votes, ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {IXERC20} from "./interfaces/IXERC20.sol";
import {IERC7802, IERC165} from "./interfaces/IERC7802.sol";
import {Ownable2StepInit, OwnableInit} from "../../utils/access/Ownable2StepInit.sol";

/**
 * @title XERC20Votes
 * @dev An XERC20 contract inheriting the ERC20Votes token functionality
 */
contract XERC20Votes is ERC20, ERC20Burnable, ERC20Permit, ERC20Votes, Ownable2StepInit, IXERC20, IERC165, IERC7802 {
    /**
     * @notice Emitted when the treasury address is updated
     * @param oldTreasury The previous treasury address
     * @param newTreasury The new treasury address
     */
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /**
     * @notice Emitted when bridge tax tiers are updated
     * @param thresholds The thresholds for the bridge tax tiers
     * @param basisPoints The basis points for the bridge tax tiers
     */
    event BridgeTaxTiersUpdated(uint256[] thresholds, uint256[] basisPoints);

    /**
     * @notice Emitted when a bridge tax is collected
     * @param user The user who minted tokens
     * @param amount The amount of tokens minted
     * @param taxAmount The amount of tax collected
     */
    event BridgeTaxCollected(address indexed user, uint256 amount, uint256 taxAmount);

    /**
     * @dev Error thrown when the parameters are invalid
     */
    error Token_InvalidParams();

    /**
     * @notice The duration it takes for the limits to fully replenish
     */
    uint256 private constant DURATION = 1 days;

    /**
     * @notice The maximum tax basis points, 50%
     */
    uint256 public constant MAX_TAX_BASIS_POINTS = 5000;

    /**
     * @notice The address of the lockbox contract
     */
    address public lockbox;

    /**
     * @notice The address of the treasury that receives bridge taxes
     */
    address public treasury;

    /**
     * @notice Structure to define a bridge tax tier
     * @param threshold The minimum amount threshold for this tier
     * @param basisPoints The tax rate in basis points (1/100 of 1%)
     */
    struct BridgeTaxTier {
        uint256 threshold;
        uint256 basisPoints;
    }

    /**
     * @notice Array of bridge tax tiers, sorted by threshold (ascending)
     * An empty array means tax is disabled
     */
    BridgeTaxTier[] public bridgeTaxTiers;

    mapping(address => Bridge) public bridges;

    /**
     * @notice Constructor for the XERC20Votes contract
     * @param name The name of the token
     * @param symbol The symbol of the token
     * @param recipients The addresses of the recipients to mint tokens to
     * @param amounts The amounts of tokens to mint to the recipients. The arrays must be the same length
     * @param _owner The address of the owner
     * @param _treasury The address of the treasury for bridge taxes, required only if bridge tax tiers are set
     * @param _bridgeTaxTierThresholds Array of thresholds for bridge tax tiers (must be sorted in ascending order), max 10 thresholds
     * @param _bridgeTaxTierBasisPoints Array of basis points for each threshold tier, max 5000 bps
     */
    constructor(
        string memory name,
        string memory symbol,
        address[] memory recipients,
        uint256[] memory amounts,
        address _owner,
        address _treasury,
        uint256[] memory _bridgeTaxTierThresholds,
        uint256[] memory _bridgeTaxTierBasisPoints
    ) ERC20(name, symbol) ERC20Permit(name) OwnableInit(_owner) {
        if ((recipients.length != amounts.length)) revert Token_InvalidParams();

        if (_treasury != address(0)) {
            treasury = _treasury;
        }

        if (_bridgeTaxTierThresholds.length > 0) {
            _setupBridgeTaxTiers(_bridgeTaxTierThresholds, _bridgeTaxTierBasisPoints);
        }

        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }

    /**
     * @dev Override default ERC20Votes implementation to use timestamp instead of block number for clock
     *
     * @return The current timestamp
     */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    /**
     * @dev Override default ERC20Votes implementation to use timestamp instead of block number for clock
     *
     * @return The clock mode
     */
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /**
     * @notice Sets the lockbox address
     *
     * @param _lockbox The address of the lockbox
     */

    function setLockbox(address _lockbox) external onlyOwner {
        lockbox = _lockbox;
        emit LockboxSet(_lockbox);
    }

    /**
     * @notice Sets the treasury address
     * @param _treasury The new treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Enables, disables, or updates the bridge tax tiers
     * @param _thresholds Array of thresholds for bridge tax tiers (must be sorted in ascending order)
     * @param _basisPoints Array of basis points for each threshold tier
     * @dev Passing empty arrays will disable bridge tax
     */
    function setBridgeTaxTiers(uint256[] memory _thresholds, uint256[] memory _basisPoints) external onlyOwner {
        if (_thresholds.length == 0 && _basisPoints.length == 0) {
            // Disable bridge tax by clearing the tiers
            delete bridgeTaxTiers;
        } else {
            _setupBridgeTaxTiers(_thresholds, _basisPoints);
        }
        emit BridgeTaxTiersUpdated(_thresholds, _basisPoints);
    }

    /**
     * @notice Check if bridge tax is enabled
     * @return True if bridge tax is enabled (tiers exist and treasury is set)
     */
    function isBridgeTaxEnabled() public view returns (bool) {
        return bridgeTaxTiers.length > 0 && treasury != address(0);
    }

    /**
     * @notice Calculate the tax amount for a given mint amount using tiered taxation
     * @param _amount The amount being minted
     * @return taxAmount The total amount of tax to be collected
     * @dev Each portion of the amount is taxed at its respective tier rate
     */
    function calculateBridgeTax(uint256 _amount) public view returns (uint256 taxAmount) {
        if (!isBridgeTaxEnabled() || _amount == 0) {
            return 0;
        }

        uint256 remainingAmount = _amount;
        uint256 processedAmount = 0;

        // First tier starts from 0 if not explicitly set
        uint256 tierStartAmount = 0;

        // Apply each tier's tax rate to its respective portion of the amount
        for (uint256 i = 0; i < bridgeTaxTiers.length; i++) {
            uint256 currentTierThreshold = bridgeTaxTiers[i].threshold;
            uint256 currentTierBps = bridgeTaxTiers[i].basisPoints;

            // Calculate the amount that falls into this tier
            uint256 tierAmount;

            if (i == bridgeTaxTiers.length - 1) {
                // Last tier handles all remaining amount
                tierAmount = remainingAmount;
            } else if (remainingAmount > currentTierThreshold - tierStartAmount) {
                // Part of the amount falls into this tier
                tierAmount = currentTierThreshold - tierStartAmount;
            } else {
                // All remaining amount falls into this tier
                tierAmount = remainingAmount;
            }

            // Calculate tax for this tier
            if (tierAmount > 0) {
                taxAmount += (tierAmount * currentTierBps) / 10000;
                processedAmount += tierAmount;
                remainingAmount -= tierAmount;
            }

            // Update start of next tier
            tierStartAmount = currentTierThreshold;

            // Break if we've processed the entire amount
            if (remainingAmount == 0) {
                break;
            }
        }

        return taxAmount;
    }

    /**
     * @notice Mints tokens for a user
     * @dev Can only be called by a bridge
     * @param _user The address of the user who needs tokens minted
     * @param _amount The amount of tokens being minted
     */

    function mint(address _user, uint256 _amount) public {
        if (msg.sender == owner()) {
            _mint(_user, _amount);
        } else {
            _mintWithCaller(msg.sender, _user, _amount);
        }
    }

    /**
     * @notice Mint tokens through a crosschain transfer.
     * @param _to The address to mint tokens to.
     * @param _amount The amount of tokens to mint.
     */
    function crosschainMint(address _to, uint256 _amount) external {
        _mintWithCaller(msg.sender, _to, _amount);
        emit CrosschainMint(_to, _amount, msg.sender);
    }

    /**
     * @notice Burns tokens for a user using bridge limits
     * @dev Can be called by a bridge. If msg.sender is not user, an allowance needs to be given.
     * @param _user The address of the user who needs tokens burned
     * @param _amount The amount of tokens being burned
     */
    function burn(address _user, uint256 _amount) public {
        _burnFrom(_user, _amount);
    }

    /**
     * @notice Burns tokens for a user using bridge limits
     * @dev Can be called by a bridge. If msg.sender is not user, an allowance needs to be given.
     * @param _user The address of the user who needs tokens burned
     * @param _amount The amount of tokens being burned
     */
    function burnFrom(address _user, uint256 _amount) public override {
        _burnFrom(_user, _amount);
    }

    /**
     * @notice Burns tokens for msg.sender using bridge limits
     * @dev Override the ERC20Burnable implementation to use bridge limits
     * @param _amount The amount of tokens being burned
     */
    function burn(uint256 _amount) public override {
        _burnWithCaller(msg.sender, msg.sender, _amount);
    }

    /**
     * @notice Burn tokens through a crosschain transfer.
     * @dev If the caller is not the from address, an allowance needs to be given.
     * @param _from The address to burn tokens from.
     * @param _amount The amount of tokens to burn.
     */
    function crosschainBurn(address _from, uint256 _amount) external {
        _spendAllowance(_from, msg.sender, _amount);
        _burnWithCaller(msg.sender, _from, _amount);
        emit CrosschainBurn(_from, _amount, msg.sender);
    }

    /**
     * @notice Updates the limits of any bridge
     * @dev Can only be called by the owner
     * @param _mintingLimit The updated minting limit we are setting to the bridge
     * @param _burningLimit The updated burning limit we are setting to the bridge
     * @param _bridge The address of the bridge we are setting the limits too
     */
    function setLimits(address _bridge, uint256 _mintingLimit, uint256 _burningLimit) external onlyOwner {
        _changeMinterLimit(_bridge, _mintingLimit);
        _changeBurnerLimit(_bridge, _burningLimit);
        emit BridgeLimitsSet(_mintingLimit, _burningLimit, _bridge);
    }

    /**
     * @notice Returns true if the contract implements the interface
     * @param interfaceId The interface id to check
     * @return True if the contract implements the interface, false otherwise
     */
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC7802).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @notice Returns the max limit of a bridge
     *
     * @param _bridge the bridge we are viewing the limits of
     * @return _limit The limit the bridge has
     */

    function mintingMaxLimitOf(address _bridge) public view returns (uint256 _limit) {
        _limit = bridges[_bridge].minterParams.maxLimit;
    }

    /**
     * @notice Returns the max limit of a bridge
     *
     * @param _bridge the bridge we are viewing the limits of
     * @return _limit The limit the bridge has
     */

    function burningMaxLimitOf(address _bridge) public view returns (uint256 _limit) {
        _limit = bridges[_bridge].burnerParams.maxLimit;
    }

    /**
     * @notice Returns the current limit of a bridge
     *
     * @param _bridge the bridge we are viewing the limits of
     * @return _limit The limit the bridge has
     */

    function mintingCurrentLimitOf(address _bridge) public view returns (uint256 _limit) {
        _limit = _getCurrentLimit(
            bridges[_bridge].minterParams.currentLimit,
            bridges[_bridge].minterParams.maxLimit,
            bridges[_bridge].minterParams.timestamp,
            bridges[_bridge].minterParams.ratePerSecond
        );
    }

    /**
     * @notice Returns the current limit of a bridge
     *
     * @param _bridge the bridge we are viewing the limits of
     * @return _limit The limit the bridge has
     */

    function burningCurrentLimitOf(address _bridge) public view returns (uint256 _limit) {
        _limit = _getCurrentLimit(
            bridges[_bridge].burnerParams.currentLimit,
            bridges[_bridge].burnerParams.maxLimit,
            bridges[_bridge].burnerParams.timestamp,
            bridges[_bridge].burnerParams.ratePerSecond
        );
    }

    /**
     * @notice Burns tokens for a user using bridge limits
     * @dev Can be called by a bridge. If msg.sender is not user, an allowance needs to be given.
     * @param _user The address of the user who needs tokens burned
     * @param _amount The amount of tokens being burned
     */
    function _burnFrom(address _user, uint256 _amount) internal {
        if (msg.sender != _user) {
            _spendAllowance(_user, msg.sender, _amount);
        }
        _burnWithCaller(msg.sender, _user, _amount);
    }

    /**
     * @notice Uses the limit of any bridge
     * @param _bridge The address of the bridge who is being changed
     * @param _change The change in the limit
     */

    function _useMinterLimits(address _bridge, uint256 _change) internal {
        uint256 _currentLimit = mintingCurrentLimitOf(_bridge);
        bridges[_bridge].minterParams.timestamp = block.timestamp;
        bridges[_bridge].minterParams.currentLimit = _currentLimit - _change;
    }

    /**
     * @notice Uses the limit of any bridge
     * @param _bridge The address of the bridge who is being changed
     * @param _change The change in the limit
     */

    function _useBurnerLimits(address _bridge, uint256 _change) internal {
        uint256 _currentLimit = burningCurrentLimitOf(_bridge);
        bridges[_bridge].burnerParams.timestamp = block.timestamp;
        bridges[_bridge].burnerParams.currentLimit = _currentLimit - _change;
    }

    /**
     * @notice Updates the limit of any bridge
     * @dev Can only be called by the owner
     * @param _bridge The address of the bridge we are setting the limit too
     * @param _limit The updated limit we are setting to the bridge
     */

    function _changeMinterLimit(address _bridge, uint256 _limit) internal {
        uint256 _oldLimit = bridges[_bridge].minterParams.maxLimit;
        uint256 _currentLimit = mintingCurrentLimitOf(_bridge);
        bridges[_bridge].minterParams.maxLimit = _limit;

        bridges[_bridge].minterParams.currentLimit = _calculateNewCurrentLimit(_limit, _oldLimit, _currentLimit);

        bridges[_bridge].minterParams.ratePerSecond = _limit / DURATION;
        bridges[_bridge].minterParams.timestamp = block.timestamp;
    }

    /**
     * @notice Updates the limit of any bridge
     * @dev Can only be called by the owner
     * @param _bridge The address of the bridge we are setting the limit too
     * @param _limit The updated limit we are setting to the bridge
     */

    function _changeBurnerLimit(address _bridge, uint256 _limit) internal {
        uint256 _oldLimit = bridges[_bridge].burnerParams.maxLimit;
        uint256 _currentLimit = burningCurrentLimitOf(_bridge);
        bridges[_bridge].burnerParams.maxLimit = _limit;

        bridges[_bridge].burnerParams.currentLimit = _calculateNewCurrentLimit(_limit, _oldLimit, _currentLimit);

        bridges[_bridge].burnerParams.ratePerSecond = _limit / DURATION;
        bridges[_bridge].burnerParams.timestamp = block.timestamp;
    }

    /**
     * @notice Updates the current limit
     *
     * @param _limit The new limit
     * @param _oldLimit The old limit
     * @param _currentLimit The current limit
     */

    function _calculateNewCurrentLimit(uint256 _limit, uint256 _oldLimit, uint256 _currentLimit) internal pure returns (uint256 _newCurrentLimit) {
        uint256 _difference;

        if (_oldLimit > _limit) {
            _difference = _oldLimit - _limit;
            _newCurrentLimit = _currentLimit > _difference ? _currentLimit - _difference : 0;
        } else {
            _difference = _limit - _oldLimit;
            _newCurrentLimit = _currentLimit + _difference;
        }
    }

    /**
     * @notice Gets the current limit
     *
     * @param _currentLimit The current limit
     * @param _maxLimit The max limit
     * @param _timestamp The timestamp of the last update
     * @param _ratePerSecond The rate per second
     */

    function _getCurrentLimit(
        uint256 _currentLimit,
        uint256 _maxLimit,
        uint256 _timestamp,
        uint256 _ratePerSecond
    ) internal view returns (uint256 _limit) {
        _limit = _currentLimit;
        if (_limit == _maxLimit) {
            return _limit;
        } else if (_timestamp + DURATION <= block.timestamp) {
            _limit = _maxLimit;
        } else if (_timestamp + DURATION > block.timestamp) {
            uint256 _timePassed = block.timestamp - _timestamp;
            uint256 _calculatedLimit = _limit + (_timePassed * _ratePerSecond);
            _limit = _calculatedLimit > _maxLimit ? _maxLimit : _calculatedLimit;
        }
    }

    /**
     * @notice Setup bridge tax tiers, Max 10 tiers can be set
     * @dev Thresholds must be sorted in ascending order, basis points must be less than or equal to MAX_TAX_BASIS_POINTS
     * @param _thresholds Array of thresholds for bridge tax tiers (must be sorted in ascending order)
     * @param _basisPoints Array of basis points for each threshold tier
     */
    function _setupBridgeTaxTiers(uint256[] memory _thresholds, uint256[] memory _basisPoints) internal {
        if (_thresholds.length != _basisPoints.length) revert Token_InvalidParams();
        if (_thresholds.length > 10) revert Token_InvalidParams();

        // Clear existing tiers
        if (bridgeTaxTiers.length > 0) {
            delete bridgeTaxTiers;
        }

        // Check threshold values are valid
        for (uint256 i = 0; i < _thresholds.length; i++) {
            // Ensure threshold is not zero (except first tier)
            if (i > 0 && _thresholds[i] == 0) revert Token_InvalidParams();
            // Ensure thresholds are in strictly ascending order
            if (i > 0 && _thresholds[i] <= _thresholds[i - 1]) revert Token_InvalidParams();
            // Ensure basis points are within valid range
            if (_basisPoints[i] > MAX_TAX_BASIS_POINTS) revert Token_InvalidParams();
            // Ensure both threshold and basis points are not zero
            if (_thresholds[i] == 0 && _basisPoints[i] == 0) revert Token_InvalidParams();

            bridgeTaxTiers.push(BridgeTaxTier({threshold: _thresholds[i], basisPoints: _basisPoints[i]}));
        }
    }

    /**
     * @notice Internal function for burning tokens
     *
     * @param _caller The caller address
     * @param _user The user address
     * @param _amount The amount to burn
     */

    function _burnWithCaller(address _caller, address _user, uint256 _amount) internal {
        if (_caller != lockbox) {
            uint256 _currentLimit = burningCurrentLimitOf(_caller);
            if (_currentLimit < _amount) revert IXERC20_NotHighEnoughLimits();
            _useBurnerLimits(_caller, _amount);
        }
        _burn(_user, _amount);
    }

    /**
     * @notice Internal function for minting tokens
     *
     * @param _caller The caller address
     * @param _user The user address
     * @param _amount The amount to mint
     */

    function _mintWithCaller(address _caller, address _user, uint256 _amount) internal {
        if (_caller != lockbox) {
            uint256 _currentLimit = mintingCurrentLimitOf(_caller);
            if (_currentLimit < _amount) revert IXERC20_NotHighEnoughLimits();
            _useMinterLimits(_caller, _amount);

            uint256 taxAmount = calculateBridgeTax(_amount);
            if (taxAmount > 0) {
                // Mint to user minus tax
                _mint(_user, _amount - taxAmount);

                // Mint bridge tax amount to treasury
                _mint(treasury, taxAmount);

                // Emit event for the tax collection
                emit BridgeTaxCollected(_user, _amount, taxAmount);
                return;
            }
        }

        // Standard minting if no tax was applied or tax is disabled
        _mint(_user, _amount);
    }

    // The following functions are overrides required by Solidity.
    function nonces(address owner) public view override(ERC20Permit) returns (uint256) {
        return super.nonces(owner);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(account, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}
