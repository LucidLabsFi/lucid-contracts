// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title CallReceiverMock
 * @notice Helper contract for testing execute and rescueETH flows
 */
contract CallReceiverMock {
    bool public rejectEther;

    function setRejectEther(bool enabled) external {
        rejectEther = enabled;
    }

    function ping(bytes calldata data) external payable returns (bytes memory) {
        return data;
    }

    function revertWithReason() external pure {
        revert("CallReceiverMock: revert");
    }

    function revertNoReason() external pure {
        assembly {
            revert(0, 0)
        }
    }

    receive() external payable {
        if (rejectEther) {
            revert("CallReceiverMock: reject");
        }
    }
}
