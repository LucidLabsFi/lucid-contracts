// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IERC4626 is IERC20, IERC20Metadata {
    function asset() external view returns (address);

    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    function convertToShares(uint256 assets) external view returns (uint256 shares);

    function deposit(uint256 assets, address onBehalf) external returns (uint256 shares);

    function mint(uint256 shares, address onBehalf) external returns (uint256 assets);

    function withdraw(uint256 assets, address receiver, address onBehalf) external returns (uint256 shares);

    function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256 assets);

    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    function previewRedeem(uint256 shares) external view returns (uint256 assets);
}
