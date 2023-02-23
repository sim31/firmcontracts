// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "./IssuedToken.sol";

contract IssuedNTT is IssuedToken {
    constructor(
        string memory name_,
        string memory symbol_,
        address issuer_
    ) IssuedToken(name_, symbol_, issuer_) {}

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from == address(0), "Only minting allowed");
    }
}

