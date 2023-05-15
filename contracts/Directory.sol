// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";
import "./Filesystem.sol";

abstract contract Directory is SelfCalled {
    Filesystem public constant FS_CONTRACT = Filesystem(0xd0432A02D6f7725cb70a206C136CE5bc7AFDD833);

    function setDir(bytes32 dirId) public fromSelf {
        FS_CONTRACT.setRoot(dirId);
    }

    function getDir() public view returns (bytes32) {
        return FS_CONTRACT.getRoot(address(this));
    }
}