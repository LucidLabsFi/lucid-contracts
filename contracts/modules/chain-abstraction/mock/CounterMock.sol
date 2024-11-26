// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract CounterMock {
    // State variable to store the count
    uint256 private count;

    // Event to be emitted when the count is incremented
    event Increment(uint256 newCount);

    // Function to get the current count
    function getCount() public view returns (uint256) {
        return count;
    }

    // Function to increment the count
    function increment() public {
        count += 1;
        emit Increment(count);
    }
}
