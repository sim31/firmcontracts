// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./IFirmChain.sol";
import "./FirmChainImpl.sol";
import "./FirmChainAbi.sol";
import "./SelfCalled.sol";
import "hardhat/console.sol";

contract FirmChain is IFirmChain, SelfCalled {
    event ByzantineFault(address source, bytes32 forkPoint);
    event WrongConfirmerSetId(bytes32 blockId);
    event ExternalCall(bytes retValue);
    event ExternalCallFail(bytes retValue);
    event ContractDoesNotExist(address addr);
    event BlockProposed(bytes32 indexed prevBlockId, Block block);
    event BlockConfirmation(
        bytes32 indexed blockId,
        address indexed confirmer
    );
    event ExtBlockConfirmation(
        bytes32 indexed blockId,
        address indexed confirmer,
        Signature sig
    );
    event BlockFinalized(bytes32 indexed prevBlockId, bytes32 indexed blockId);
    event BlockExecuted(bytes32 indexed blockId, Block block);
    event Construction();

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
        Signature calldata sig
    ) external returns (bool) {
        return _impl.extConfirm(header, signatory, sig);
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

    function sync(SignedBlock[] calldata blocks) external {
        _impl.sync(blocks);
    }

    function propose(Block calldata bl) public virtual {
        _impl.propose(bl);
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

    function getConfirmerStatus(address confirmer) external view returns (ConfirmerStatus) {
        return _impl.getConfirmerStatus(confirmer);
    }

    function isConfirmedBy(bytes32 blockId, address confirmer) public view returns (bool) {
        return _impl.isConfirmedBy(blockId, confirmer);
    }

    function isFinalized(bytes32 blockId) public view returns (bool) {
        return _impl.isFinalized(blockId);
    }
}
