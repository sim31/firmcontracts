// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "./IFirmChain.sol";
import "./FirmChainAbi.sol";
import "./FirmChainImpl.sol";
import "hardhat/console.sol";

contract FirmChain is IFirmChain {
    event ByzantineFault(address source, bytes32 forkPoint);
    event ConfirmFail(address code);

    using FirmChainImpl for FirmChainImpl.FirmChain;

    FirmChainImpl.FirmChain internal _impl;

    constructor(
        Block memory genesisBl,
        Confirmer[] memory confirmers,
        uint8 threshold

    ) {
        _impl.init(genesisBl, confirmers, threshold);
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
        Confirmer[] calldata toRemove,
        Confirmer[] calldata toAdd,
        uint8 threshold
    ) external {
        _impl.updateConfirmerSet(toRemove, toAdd, threshold);
    }
}
