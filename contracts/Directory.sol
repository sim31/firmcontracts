// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract Directory {
  mapping(address => bytes32) private _links;

  function setLink(bytes32 link) public {
    _links[msg.sender] = link;
  }

  function linkOf(address addr) public view returns (bytes32) {
    return _links[addr];
  }
}