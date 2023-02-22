// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "./IFirmChain.sol";
import "./FirmChainImpl.sol";
import "./FirmChainAbi.sol";
import "hardhat/console.sol";

contract FirmChain is IFirmChain {
    event ByzantineFault(address source, bytes32 forkPoint);
    event ConfirmFail(address code);

    using FirmChainImpl for FirmChainImpl.FirmChain;

    FirmChainImpl.FirmChain internal _impl;

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold
    ) {
        _impl.construct(genesisBl, confirmerOps, threshold);
    }

    function confirm(BlockHeader calldata header) external returns (bool) {
        return _impl.confirm(header);
    }

    // sender can be anyone but check that header contains valid signature
    // of account specified.
    function extConfirm(
        BlockHeader calldata header,
        address signatory,
        uint8 sigIndex
    ) external returns (bool) {
        return _impl.extConfirm(header, signatory, sigIndex);
    }

    function finalize(BlockHeader calldata header) external {
        _impl.finalize(header);
    }

    function finalizeAndExecute(Block calldata bl) external {
        _impl.finalizeAndExecute(bl);
    }
    function execute(Block calldata bl) external {
        _impl.execute(bl);
    }

    function updateConfirmerSet(
        ConfirmerOp[] calldata ops,
        uint8 threshold
    ) external {
        _impl.updateConfirmerSet(ops, threshold);
    }

    function getConfirmers() external view returns (bytes32[] memory) {
        return _impl.getConfirmers();
    }

    function getThreshold() external view returns (uint8) {
        return _impl.getThreshold();
    }

    function getHead() external view returns (bytes32) {
        return _impl.getHead();
    }

    function isConfirmedBy(bytes32 blockId, address confirmer) public view returns (bool) {
        return _impl.isConfirmedBy(blockId, confirmer);
    }

    function isFinalized(bytes32 blockId) public view returns (bool) {
        return _impl.isFinalized(blockId);
    }
}
