// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./Directory.sol";
import "./FirmChain.sol";

contract FirmDirectory is FirmChain, Directory {
    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold
    ) FirmChain(genesisBl, confirmerOps, threshold) {}
}