// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "./IFirmChain.sol";
import "./FirmChainAbi.sol";
import "hardhat/console.sol";

contract FirmChain is IFirmChain {
    event ByzantineFault(address source, bytes32 forkPoint);
    event ConfirmFail(address code);

    using FirmChainAbi for ConfirmerSet;

    struct Link {
        address confirmer;
        bytes32 blockId;
    }

    enum ConfirmerStatus {
        UNINITIALIZED,
        INITIALIZED,
        FAULTY
    }

    // TODO: Expose some of these variables with getters?
    // Link(confirmer X, Block A) => block B, which A extends (confirms) (e.g. chain: A -> B -> C)
    // Link(this, A) is filled only if A is finalized according to this contract;
    // Link(X, A) is filled if A is confirmed by X;
    mapping(bytes => bytes32) internal _backlinks;
    // Link(confirmer X, block A) => block which extends (confirms) A (e.g. B in chain: C -> B -> A)
    // Link(this, A) => B: is only stored if A is extended by B and B is finalized;
    // Link(X, A) => B: is stored if A is extended by B and B is confirmed by X;
    mapping(bytes => bytes32) internal _forwardLinks;
    // Like forwardLinks but stores alternative forks
    mapping(bytes => bytes32[]) internal _conflictForwardLinks;
    bytes32 private _confirmerSetId;
    ConfirmerSet private _confirmerSet;
    mapping(address => ConfirmerStatus) _confirmerStatus;
    // Last finalized block
    bytes32 internal _head;
    bool internal _fault = false;

    constructor(Block memory genesisBl) goodTs(genesisBl.header.timestamp) {
        console.log("Constructor");
        require(
            genesisBl.header.code == address(0),
            "Code has to be set to 0 in genesis block"
        );
        require(
            genesisBl.header.prevBlockId == 0,
            "prevBlockId has to be set to 0 in genesis block"
        );
        require(
            FirmChainAbi.verifyBlockBodyId(genesisBl),
            "Passed block body does not match header.blockDataId"
        );
        require(
            genesisBl.confirmerSetId != 0,
            "Confirmer set has to be set"
        );
        console.log("Parsing commands");
        Command[] memory cmds = FirmChainAbi.decodeCmdsMem(
            genesisBl.blockData
        );

        console.log("Updating confirmer set. Length: %i", cmds.length);
        for (uint i = 0; i < cmds.length; i++) {
            console.log("Cmd: %i", i);
            _confirmerSet.updateConfirmerSet(cmds[i]);
        }
        _confirmerSetId = _confirmerSet.getConfirmerSetId();
        require(
            _confirmerSetId == genesisBl.confirmerSetId,
            "Declared confirmer set does not match computed"
        );

        console.log("Computing block id");
        bytes32 bId = FirmChainAbi.getBlockId(genesisBl.header);

        console.log("Setting backlings and _head");
        _backlinks[packedLink(address(this), bId)] = "1";
        _head = bId;
    }

    function confirm(BlockHeader calldata header) external returns (bool) {
        require(msg.sender != address(this));
        return _confirm(header, msg.sender);
    }

    // sender can be anyone but check that header contains valid signature
    // of account specified.
    function extConfirm(
        BlockHeader calldata header,
        address signatory,
        uint8 sigIndex
    ) external returns (bool) {
        require(FirmChainAbi.verifyBlockSig(header, sigIndex, signatory));
        return _confirm(header, signatory);
    }

    function _confirm(
        BlockHeader calldata header,
        address confirmerAddr
    ) private nonFaulty goodTs(header.timestamp) returns (bool) {
        require(header.code == address(this));

        bytes32 bId = FirmChainAbi.getBlockId(header);

        // Check if id not already confirmed by the sender
        // Note: this is not necessarily a fault by a sender, it might be
        // an attempted replay of senders block.
        require(
            !isConfirmedBy(bId, confirmerAddr),
            "Block already confirmed by this confirmer"
        );

        // Get id of the block this block extends and check if it is finalized;
        bytes32 prevId = header.prevBlockId;
        require(isFinalized(prevId), "Previous block has to be finalized.");

        // Get id of the block this block extends and check if sender
        //   has not already attempted to extend this block with some other. If so, mark him as faulty.
        // Note that we already checked that `header` block is not yet confirmed.
        //   Therefore whatever block is extending `prevId`, it is not `header`
        if (isExtendedBy(prevId, confirmerAddr)) {
            confirmerFault(confirmerAddr, prevId, bId);
        }

        // Get id of the block this block extends and check if that block
        //   has not yet been extended with some other *finalized* block.
        //   If so, mark sender as faulty.
        if (isExtendedBy(prevId, address(this))) {
            confirmerFault(confirmerAddr, prevId, bId);
        }

        // Store confirmation
        if (_confirmerStatus[confirmerAddr] != ConfirmerStatus.FAULTY) {
            _backlinks[packedLink(msg.sender, bId)] = prevId;
            _forwardLinks[packedLink(msg.sender, prevId)] = bId;
            return true;
        } else {
            return false;
        }
    }

    function finalize(Block calldata bl) external nonFaulty {
        // Already checked `code` and `timestamp` in confirm

        // Check if it extends head (current LIB)
        // It has to be current head (LIB) because we don't allow even confirming
        // non-finalized blocks (so it cannot be some block previous to _head).
       bytes32 prevId = bl.header.prevBlockId;
        require(
            prevId == _head,
            "Previous block has to be current _head"
        );

        // TODO: Add these functions as members of Block, BlockHeader
        require(
            FirmChainAbi.verifyBlockBodyId(bl),
            "Passed block body does not match header.blockDataId"
        );

        // Go through current confirmers and count their confirmation weight
        bytes32 bId = FirmChainAbi.getBlockId(bl.header);
        uint16 sumWeight = 0;
        for (uint i = 0; i < _confirmerSet.confirmersLength(); i++) {
            Confirmer memory c = _confirmerSet.confirmerAt(i);
            if (isConfirmedBy(bId, c.addr)) {
                sumWeight += c.weight;
            }
        }
        require(
            sumWeight >= _confirmerSet.getConfirmerThreshold(),
            "Not enough confirmations"
        );

        execute(bl);
        require(_confirmerSetId == bl.confirmerSetId);

        require(_confirm(bl.header, address(this)));

        _head = bId;

        for (uint i = 0; i < bl.confirmedBl.length; i++) {
            IFirmChain code = IFirmChain(bl.confirmedBl[i].code);
            // confirm function, the way it is implemented in this contract does not allow
            // sender of confirm to be this contract.
            try code.confirm(bl.header) {} catch {
                emit ConfirmFail(address(code));
            }
        }
    }

    function proveFault(
        Block calldata b1,
        Confirmer[] calldata confirmers,
        uint8 threshold,
        Block calldata b2
    ) external nonFaulty {
        // * Calculate hash of passed confirmer set (id);
        bytes32 confId = FirmChainAbi.getConfirmerSetId(confirmers, threshold);
        // * Check id is as specified in b1;
        require(confId == b1.confirmerSetId);
        // * Check that b1 is finalized;
        bytes32 b1Id = FirmChainAbi.getBlockId(b1.header);
        require(isFinalized(b1Id));
        // * Calculate id of b2;
        bytes32 b2Id = FirmChainAbi.getBlockId(b2.header);
        // * Check if b1 is extended with finalized block other than b2
        bytes32 altId = getExtendingBlock(b1Id, address(this));
        require(altId != b2Id);
        // * Check that either _conflictForwardLinks and _forwardLinks have enough confirmations for b2 (confirmer, b1) -> b2
        uint16 sumWeight = 0;
        for (uint i = 0; i < confirmers.length; i++) {
            Confirmer memory c = confirmers[i];
            if (
                isConfirmedBy(b2Id, c.addr) ||
                conflConfirmationExists(b1Id, b2Id, c.addr)
            ) {
                sumWeight += c.weight;
            }
        }
        require(sumWeight >= threshold);
        // * Mark this chain as faulty
        _fault = true;
        // * Emit event
        emit ByzantineFault(address(this), b1Id);
    }

    function confirmerFault(
        address confirmer,
        bytes32 prevId,
        bytes32 nextId
    ) private {
        _confirmerStatus[confirmer] = ConfirmerStatus.FAULTY;
        if (!conflConfirmationExists(prevId, nextId, confirmer)) {
            _conflictForwardLinks[packedLink(confirmer, prevId)].push(nextId);
            emit ByzantineFault(confirmer, prevId);
        }
    }

    function handleCommand(
        Block calldata bl,
        Command memory cmd
    ) internal virtual returns (bool handled) {
        return false;
    }

    // This function should not access any external state,
    // so that if confirmers executed executed successfully before confirming,
    // it would execute successfully on any other platform as well.
    function execute(Block calldata bl) internal virtual {
        Command[] memory cmds = FirmChainAbi.decodeCmds(bl.blockData);
        bool confirmersChanged = false;
        for (uint i = 0; i < cmds.length; i++) {
            if (!handleCommand(bl, cmds[i])) {
                confirmersChanged = _confirmerSet.updateConfirmerSet(cmds[i]);
            }
        }

        if (confirmersChanged) {
            _confirmerSetId = _confirmerSet.getConfirmerSetId();
        }
    }

    function packLink(Link calldata c) public pure returns (bytes memory) {
        return abi.encodePacked(c.confirmer, c.blockId);
    }

    function packedLink(
        address confirmer,
        bytes32 bId
    ) public pure returns (bytes memory) {
        return abi.encodePacked(confirmer, bId);
    }

    function getExtendingBlock(
        bytes32 blockId,
        address confirmer
    ) public view returns (bytes32) {
        return _forwardLinks[packedLink(confirmer, blockId)];
    }

    function isExtendedBy(
        bytes32 blockId,
        address confirmer
    ) public view returns (bool) {
        return getExtendingBlock(blockId, confirmer) != 0;
    }

    function getExtendedBlock(
        bytes32 confirmingBlock,
        address confirmer
    ) public view returns (bytes32) {
        return _backlinks[packedLink(confirmer, confirmingBlock)];
    }

    function getConflExtendingIds(
        bytes32 prevId,
        address confirmer
    ) internal view returns (bytes32[] storage) {
        bytes32[] storage extendingIds = _conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        return extendingIds;
    }

    function conflConfirmationExists(
        bytes32 prevId,
        bytes32 nextId,
        address confirmer
    ) public view returns (bool) {
        bytes32[] storage confirmingIds = _conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        for (uint i = 0; i < confirmingIds.length; i++) {
            if (confirmingIds[i] == nextId) {
                return true;
            }
        }
        return false;
    }

    function conflConfirmationExists(
        bytes32 prevId,
        address confirmer
    ) public view returns (bool) {
        bytes32[] storage confirmingIds = _conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        return confirmingIds.length > 0;
    }

    function isConfirmedBy(
        bytes32 blockId,
        address confirmer
    ) public view returns (bool) {
        return getExtendedBlock(blockId, confirmer) != 0;
    }

    function isFinalized(bytes32 blockId) public view returns (bool) {
        return isConfirmedBy(blockId, address(this));
    }

    modifier goodTs(uint ts) {
        require(
            ts <= block.timestamp,
            "Block timestamp is later than current time"
        );
        _;
    }

    modifier nonFaulty() {
        require(!_fault, "Fault was detected");
        _;
    }
}
