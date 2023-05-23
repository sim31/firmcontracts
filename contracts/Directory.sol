// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";
import "./Filesystem.sol";
import "hardhat/console.sol";

abstract contract Directory is SelfCalled {
    Filesystem public constant FS_CONTRACT = Filesystem(0x59E545B6980019f975234B728aE4d3668Ec21F8C);

    constructor(bytes32 abiCID) {
        console.log("Directory constructor");
        FS_CONTRACT.setAbi(abiCID);
        console.log("Directory constructor 2");
    }

    function setDir(bytes32 dirId) public fromSelf {
        FS_CONTRACT.setRoot(dirId);
    }

    function getDir() public view returns (bytes32) {
        return FS_CONTRACT.getRoot(address(this));
    }
}