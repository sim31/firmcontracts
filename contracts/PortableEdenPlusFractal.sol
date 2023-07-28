// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import './EdenPlusFractal.sol';
import "hardhat/console.sol";

contract PortableEdenPlusFractal is EdenPlusFractal {
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
    function balanceOf(address addr) public view override isHere returns (uint256) {
        return super.balanceOf(addr);
    }

    function balanceOfAccount(AccountId accountId) public view override isHere returns (uint256) {
        return super.balanceOfAccount(accountId);
    }

    function accounts() public view override isHere returns (Account[] memory) {
        return super.accounts();
    }

    function getAccount(AccountId id) public view override isHere returns (Account memory) {
        return super.getAccount(id);
    }

    function byAddress(address addr) public view override isHere returns (AccountId) {
        return super.byAddress(addr);
    }

    function accountExists(AccountId id) public view override isHere returns (bool) {
        return super.accountExists(id);
    }

    function getDir() public view override isHere returns (bytes32) {
        return super.getDir();
    }

    function getDelegate(uint8 weekIndex, uint8 roomIndex) public view override isHere returns (AccountId) {
        return super.getDelegate(weekIndex, roomIndex);
    }

    function getDelegates(uint8 weekIndex) public view override isHere returns (AccountId[] memory) {
        return super.getDelegates(weekIndex);
    }
}