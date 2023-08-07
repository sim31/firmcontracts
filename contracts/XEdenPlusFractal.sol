// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import './EdenPlusFractal.sol';
import "hardhat/console.sol";

// Cross-chain / Cross-platform EdenPlusFractal
contract XEdenPlusFractal is EdenPlusFractal {
    uint internal _hostChainId = 0;

    constructor(
        Block memory genesisBl,
        Account[] memory confirmers,
        uint8 threshold,
        string memory name_,
        string memory symbol_,
        bytes32 abiCID,
        uint hostChainId
    ) EdenPlusFractal(
        genesisBl, confirmers, threshold, name_,
        symbol_, abiCID
    ) {
        _hostChainId = hostChainId;
    }

    function getHostChain() public view returns (uint) {
        return _hostChainId;
    } 

    function setHostChain(uint hostId) external fromSelf {
        _hostChainId = hostId;
    }

    modifier isHere() {
        if (msg.sender != address(this)) {
            require(
                _hostChainId == 0 || block.chainid == 0 || _hostChainId == block.chainid,
                "moved"
            );
        }
        _;
    }

    /// OVERRIDEN METHODS (adding 'isHere' modifier) ///
    function propose(Block calldata bl) public override isHere {
      super.propose(bl);
    }

}