// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChain.sol";

contract DeviceChain is FirmChain {

    address key;

    constructor(address k) {
        key = k;
    }

    function verifySignature(BlockHeader calldata header) internal override returns(bool) {
        // TODO: verify if header.attachments contain signature of header by key;
    }

    function execute(Block calldata bl) internal override {
        // TODO: 
        // * parse commands from blockData
        // * Parse SET_KEY
        // * Set key accordingly
    }
}