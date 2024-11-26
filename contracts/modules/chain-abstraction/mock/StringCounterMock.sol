// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract StringCounterMock {
    string private text;
    uint256 public counter;

    // Event to log whenever the string is updated
    event TextUpdated(string newText, uint256 updateCount);

    // Function to set a new string of text and increment the counter
    function setText(string memory newText) public {
        text = newText;
        counter += 1;

        // Emit event when the text is updated
        emit TextUpdated(newText, counter);
    }

    // Function to retrieve the stored string
    function getText() public view returns (string memory) {
        return text;
    }
}
