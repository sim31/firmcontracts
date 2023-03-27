// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";

abstract contract Directory is SelfCalled {
    bytes32 public directoryId;

    function setDir(bytes32 dirId) public fromSelf {
        directoryId = dirId;
    }
}