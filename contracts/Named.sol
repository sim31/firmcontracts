// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

contract Named {
    string public name;

    constructor(string memory name_) {
        name = name_;
    }
}