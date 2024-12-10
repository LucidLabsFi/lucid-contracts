// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.15;

import {RolesAuthority, Authority} from "solmate/src/auth/authorities/RolesAuthority.sol";

contract BondAuthority is RolesAuthority {
    //set _authority to 0x0000000000000000000000000000000000000000
    constructor(address _owner, Authority _authority) RolesAuthority(owner, _authority) {}
}
