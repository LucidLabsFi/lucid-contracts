// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Enum} from "./gnosis/Enum.sol";
import {IGnosisSafe} from "./gnosis/IGnosisSafe.sol";
import {IPausable} from "./interfaces/IPausable.sol";

contract LucidHelper {
    string private constant ERROR_UNAUTHORIZED = "Unauthorised call";

    /// @notice the role that can append contracts to the array
    address public appender;

    /// @notice the role bearer
    address public keeper;

    /// @notice Multisig contract
    address public safe;

    /// @dev contracts addresses hashmap
    address[] public contracts;

    /// @dev contracts addresses hashmap
    mapping(address => bool) isContractPresent;

    /// @dev limits the function callers to `safe` or `keeper`
    modifier keeperOrSafe() {
        require(msg.sender == keeper || msg.sender == safe, ERROR_UNAUTHORIZED);
        _;
    }

    /// @dev limits the function callers to `safe`, `appender` or `keeper`
    modifier keeperOrAppenderOrSafe() {
        require(msg.sender == keeper || msg.sender == appender || msg.sender == safe, ERROR_UNAUTHORIZED);
        _;
    }

    /// @dev limits the function caller to `safe` only
    modifier onlySafe() {
        require(msg.sender == safe, ERROR_UNAUTHORIZED);
        _;
    }

    /// @dev Emitted when a contract address is altered
    /// @param index the position of the address on the list
    /// @param _contract the address of the contract that was altered
    /// @param operation the kind of change
    event ContractUpdated(uint256 index, address _contract, string operation);

    /// @dev Emitted when a contract pausing failed
    /// @param contractAddress contract address whose pausing failed
    event PauseFailed(address contractAddress);

    /// @dev Emitted when a contract unpausing failed
    /// @param contractAddress contract address whose unpausing failed
    event UnpauseFailed(address contractAddress);

    /// @dev Emitted when the keeper address is updated
    /// @param newKeeper the replacing keeper address
    event KeeperUpdated(address newKeeper);

    /// @dev Emitted when a safe address is updated
    /// @param newSafe the new safe address
    event SafeUpdated(address newSafe);

    /// @dev Emitted when the appender address is updated
    /// @param newAppender the replacing appender address
    event AppenderUpdated(address newAppender);

    constructor(address newAppender, address newKeeper, address newSafe) {
        // Step 1: Verify input
        // Step 1.1: Revert early if the `newAppender` is address zero
        _expectNonZeroAddress(newAppender, "newAppender is address zero");
        // Step 1.2: Revert early if the `newKeeper` is address zero
        _expectNonZeroAddress(newKeeper, "newKeeper is address zero");
        // Step 1.3: Revert early if the `newSafe` is not a contract
        _expectContract(newSafe, "newSafe is not a contract");
        // Step 2: Update storage
        appender = newAppender;
        keeper = newKeeper;
        safe = newSafe;
    }

    //      P U B L I C   F U N C T I O N S

    /// @notice Saves a new contract
    /// @dev REVERTS IF: caller is not `safe`, `appender` or `keeper`
    /// @param _contract the added contract
    function addContract(address _contract) public keeperOrAppenderOrSafe {
        _addContract(_contract);
    }

    /// @notice Saves a batch of contracts
    /// @dev REVERTS IF: caller is not `safe`, `appender` or `keeper`
    /// @param _contracts an array of the contract addresses to be added
    function addContracts(address[] memory _contracts) external keeperOrAppenderOrSafe {
        // Step 1: Compute the length once
        uint length = _contracts.length;

        // Step 2: loop over the addresses in the `_contracts`
        for (uint256 index = 0; index < length; ++index) {
            // Add the contract address to the `contracts` array
            _addContract(_contracts[index]);
        }
    }

    /// @notice Delets a contract by index
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    /// @param index the position of the contract address in the list
    function deleteContract(uint256 index) external keeperOrSafe {
        // Step 0: Verify input
        if (index >= contracts.length) revert("Out of index range");
        // Step 1: Trigger the deletion logic
        _deleteContract(index);
    }

    /// @notice  Delets a range of contracts
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    /// @param from the initial index
    /// @param to the final index
    function deleteContracts(uint256 from, uint256 to) external keeperOrSafe {
        // Step 0: Verify input
        (from, to) = _rangeCheck(from, to);
        // Step 1: Loop over the index range
        for (uint256 i = to; i > from; --i) {
            // Delete the contract at the index
            _deleteContract(i - 1);
        }
    }

    /// @notice Deletes all the contract addresses
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    function deleteAllContracts() external keeperOrSafe {
        // Step 1: Compute the length once
        uint256 length = contracts.length;
        // Step 2: Loop over the indices
        for (uint256 i = 0; i < length; ++i) {
            // Step 2.1: store the last contracts address
            address deletedContract = contracts[contracts.length - 1];
            // Step 2.2: delete the last array item
            contracts.pop();
            // Step 2.3: Remove the contract address from known
            isContractPresent[deletedContract] = false;
            // Step 2.4 Notify the external observers
            emit ContractUpdated(contracts.length, deletedContract, "Deleted");
        }
    }

    /// @notice Fetches a contract by its index
    /// @dev reverts if index >= contracts.length
    /// @param index the requested contract index
    /// @return _contract a contract address found at `index`
    function getContract(uint256 index) public view returns (address _contract) {
        // Step 1: revert early if the `index` is out of range
        if (index >= contracts.length) revert("Out of index range");
        // Step 2: return the contract address at `index`
        _contract = contracts[index];
    }

    /// @notice Fetches the number of contracts
    /// @return - the number of items in the `contracts` array
    function contractsLength() public view returns (uint256) {
        return contracts.length;
    }

    /// @notice Fetches an array of contract addresses
    /// @dev Reverts if from is greater than to
    /// @param from the initial contract index (inclusive)
    /// @param to the final contract index (exclusive)
    /// @return _contracts an array of the contract addresses within the `from` - `to` index range
    function getContracts(uint256 from, uint256 to) public view returns (address[] memory _contracts) {
        // Step 0: Verify input
        (from, to) = _rangeCheck(from, to);
        // Step 1: allocate memory
        _contracts = new address[](to - from);
        // Step 2: allocate memory for the counter
        uint256 counter = 0;
        // Step 3: Loop over the index range
        for (uint256 index = from; index < to; ++index) {
            // Step 3.1: Populate the returned array with a contract address from the storage at the index
            _contracts[counter] = contracts[index];
            // Step 3.2: increment the counter
            ++counter;
        }
    }

    /// @notice Pauses the range of contracts
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    /// @param from the initial contract index (inclusive)
    /// @param to the final contract index (exclusive)
    function pause(uint256 from, uint256 to) external keeperOrSafe {
        // Step 1: Verify input
        // Step 1.1: Ensure the `from` & `to` make sense for the `contracts` array
        (from, to) = _rangeCheck(from, to);
        // Step 1.1: Encode the low level call data for calling the `pause()` function
        bytes memory callData = abi.encodeWithSelector(IPausable.pause.selector);
        // Step 2: loop over the indices
        for (uint256 index = from; index < to; ++index) {
            // Step 2.1: Trigger the execute from module of the gnosis safe
            bool success = IGnosisSafe(payable(safe)).execTransactionFromModule(contracts[index], 0, callData, Enum.Operation.Call);
            // Step 2.2: Notify the external entities which contract's pausing failed
            if (!success) emit PauseFailed(contracts[index]);
        }
    }

    /// @notice Pauses all the contracts
    function pauseAll() external keeperOrSafe {
        uint256 length = contracts.length;
        bytes memory callData = abi.encodeWithSelector(IPausable.pause.selector);
        for (uint256 index; index < length; ++index) {
            bool success = IGnosisSafe(payable(safe)).execTransactionFromModule(contracts[index], 0, callData, Enum.Operation.Call);
            if (!success) emit PauseFailed(contracts[index]);
        }
    }

    /// @notice Unpauses the range of contracts
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    /// @param from the initial contract index (inclusive)
    /// @param to the final contract index (exclusive)
    function unpause(uint256 from, uint256 to) external onlySafe {
        // Step 1: Verify input
        // Step 1.1: Ensure the `from` & `to` make sense for the `contracts` array
        (from, to) = _rangeCheck(from, to);
        // Step 1.1: Encode the low level call data for calling the `unpause()` function
        bytes memory callData = abi.encodeWithSelector(IPausable.unpause.selector);
        // Step 2: loop over the indices
        for (uint256 index = from; index < to; ++index) {
            // Step 2.1: Trigger the execute from module of the gnosis safe
            bool success = IGnosisSafe(payable(safe)).execTransactionFromModule(contracts[index], 0, callData, Enum.Operation.Call);
            // Step 2.2: Notify the external entities which contract's pausing failed
            if (!success) emit UnpauseFailed(contracts[index]);
        }
    }

    /// @notice Unpauses all the contracts
    function unpauseAll() external onlySafe {
        uint256 length = contracts.length;
        bytes memory callData = abi.encodeWithSelector(IPausable.unpause.selector);
        for (uint256 index; index < length; ++index) {
            bool success = IGnosisSafe(payable(safe)).execTransactionFromModule(contracts[index], 0, callData, Enum.Operation.Call);
            if (!success) emit UnpauseFailed(contracts[index]);
        }
    }

    /// @notice Replaces the keeper address
    /// @dev REVERTS IF: caller is not `safe` or `keeper`
    /// @param newKeeper the address of the new keeper
    function updateKeeper(address newKeeper) external keeperOrSafe {
        // Step 1: Ensure the new `keeper` is not address zero
        _expectNonZeroAddress(newKeeper, "Zero address");
        // Step 2: Update the storage variable
        keeper = newKeeper;
        // Step 3: Notify the external entities of the `keeper` change
        emit KeeperUpdated(newKeeper);
    }

    /// @notice Replaces the appender address
    /// @dev REVERTS IF: caller is not `safe` or `appender`
    /// @param newAppender the address of the new appender
    function updateAppender(address newAppender) external keeperOrAppenderOrSafe {
        // Step 1: Ensure the new `appender` is not address zero
        _expectNonZeroAddress(newAppender, "Zero address");
        // Step 2: Update the storage variable
        appender = newAppender;
        // Step 3: Notify the external entities of the `appender` change
        emit AppenderUpdated(newAppender);
    }

    /// @notice Replaces the multisig address
    /// @dev REVERTS IF: caller is not `safe`
    /// @param newSafe the address of the new Gnosis Safe
    function updateSafe(address newSafe) external onlySafe {
        // Step 1: Ensure the `newSafe` is a contract
        _expectContract(newSafe, "newSafe is not a contract");
        // Step 2: Update the storage
        safe = newSafe;
        // Step 3: Notify the external entities of the `safe` change
        emit SafeUpdated(newSafe);
    }

    // private functions

    function _addContract(address _contract) private keeperOrAppenderOrSafe {
        // Step 1: Ensure the `contractAddress` is not address zero
        _expectContract(_contract, "address provided is not a contract");
        // Step 2: Update the storage
        if (!isContractPresent[_contract]) {
            // Step 2.1: append the new item
            contracts.push(_contract);
            // Step 2.2: Mark the contract present
            isContractPresent[_contract] = true;
            // Step 2.3: Notify the external entities
            emit ContractUpdated(contracts.length - 1, _contract, "Added");
        }
    }

    /// @dev A single contract deletion logic
    /// @param index the index of the deleted contract
    function _deleteContract(uint256 index) private {
        // Step 1: Verify input
        require(contractsLength() > 0, "No available contracts");
        // Step 2: swap the last item with the removed one
        // Step 2.1: save the deleted contract address locally
        address deletedContract = contracts[index];
        // Step 2.2: Replace the item at index with the last item
        contracts[index] = contracts[contracts.length - 1];
        // Step 3: Delete the item
        // Step 3.1: Remove the array's last item
        contracts.pop();
        // Step 3.2: mark the contract address absent
        isContractPresent[deletedContract] = false;
        // Step 4: Notify the external observers
        emit ContractUpdated(contracts.length, deletedContract, "Deleted");
    }

    /// @dev Verifies whether `a` is address zero
    /// @dev REVERTS IF: `a` equals address zero
    /// @param a a verified address
    /// @param message an injected revert reason
    function _expectNonZeroAddress(address a, string memory message) private pure {
        if (a == address(0)) revert(message);
    }

    /// @dev Verifies whether `a` is a contract
    /// @dev REVERTS IF: `a` has no code attached
    /// @param a a verified address
    /// @param message an injected revert reason
    function _expectContract(address a, string memory message) private view {
        // Step 1: Ensure non-zero address
        _expectNonZeroAddress(a, message);
        // Step 2: Revert if there's no code
        if (a.code.length == 0) revert(message);
    }

    /// @dev `from` & `to` params verification
    /// @dev REVERTS IF:
    ///      1. The contracts array is empty
    ///      2. the initial index `from` is greater than the final index `to`
    /// @param from the initial index
    /// @param to the final index
    function _rangeCheck(uint256 from, uint256 to) private view returns (uint256 _from, uint256 _to) {
        // Step 1: Revert early if the contracts array is empty
        if (contracts.length == 0) revert("No available contracts");
        // Step 2: Revert if the initial index is greater than the final one
        if (from >= to) revert("from is greater than to");
        // Step 3: Fix the final index if it was out of the range
        _to = to > contracts.length ? contracts.length : to;
        // Step 4: Populate the returned `_from`
        _from = from;
    }
}
