// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./AccountSystem.sol";
import "./FirmChain.sol";
import "./Named.sol";

contract FirmAccountSystem is Named, FirmChain, AccountSystem {
    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        string memory name
    ) Named(name) FirmChain(genesisBl, confirmerOps, threshold) {}
}