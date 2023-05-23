// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

contract Filesystem {
    mapping(address => bytes32) _roots;

    event SetRoot(address addr, bytes32 rootCID);
    event AbiSignal(bytes32 rootCID);

    function setRoot(bytes32 cid) public {
        _roots[msg.sender] = cid;
        emit SetRoot(msg.sender, cid);
    }

    function getRoot(address addr) public view returns (bytes32) {
        return _roots[addr];
    }

    // Should be called on construction
    function setAbi(bytes32 cid) public {
        emit AbiSignal(cid);        
    }
}