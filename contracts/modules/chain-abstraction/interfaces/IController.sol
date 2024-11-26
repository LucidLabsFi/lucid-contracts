// SPDX-License-Identifier: MIT
pragma solidity >=0.8.19 <=0.8.20;

interface IController {
    /**
     * @notice Registers a received message.
     * @param message The received message data in bytes.
     * @param originChain The origin chain ID.
     * @param originSender The address of the origin sender. (controller in origin chain)
     */
    function receiveMessage(bytes calldata message, uint256 originChain, address originSender) external;

    /**
     * @notice Returns the controller address for a given chain ID.
     * @param chainId The chain ID.
     * @return The controller address.
     */
    function getControllerForChain(uint256 chainId) external view returns (address);
}
