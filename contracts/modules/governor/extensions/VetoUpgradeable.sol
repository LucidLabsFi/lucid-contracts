// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";

abstract contract VetoUpgradeable is Initializable, GovernorUpgradeable {
    error Veto_NotVetoer();
    error Veto_TooLate();

    event ProposalVetoed(uint256 proposalId);

    address public vetoer;

    /// @dev Reserved storage space to allow for layout changes in future contract upgrades.
    uint256[50] private __gap;

    /**
     * @dev Initialize the Veto contract parameters.
     */
    function __Veto_init(address _vetoer) internal onlyInitializing {
        __Veto_init_unchained(_vetoer);
    }

    function __Veto_init_unchained(address _vetoer) internal onlyInitializing {
        vetoer = _vetoer;
    }

    /**
     * @dev Can be called whie the proposal hasn't been executed yet
     * @param targets Target addresses of the proposal
     * @param values Values to be sent to the targets
     * @param calldatas Encoded params to be sent to the targets
     * @param descriptionHash keccak256 hash of the proposal description
     */
    function veto(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash) public {
        if (msg.sender != vetoer) revert Veto_NotVetoer();
        uint256 proposalId = hashProposal(targets, values, calldatas, descriptionHash);
        if (state(proposalId) != ProposalState.Pending) revert Veto_TooLate();

        _cancel(targets, values, calldatas, descriptionHash);
        emit ProposalVetoed(proposalId);
    }

    /**
     * @dev Setting the address to zero address will disable the veto functionality
     * @param _vetoer The address of the new vetoer
     */
    function updateVetoer(address _vetoer) public onlyGovernance {
        vetoer = _vetoer;
    }
}
