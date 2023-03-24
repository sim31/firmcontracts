// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

contract SelfCalled {
    modifier fromSelf() {
        require(msg.sender == address(this), "Can only be called by self");
        _;
    }
}