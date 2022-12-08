// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./IFirmChain.sol";


contract FirmChain is IFirmChain {

    event ByzantineFault(BlockId conflictB1, BlockId conflictB2);

    struct Link {
        address confirmer;
        BlockId blockId;
    }

    enum ConfirmerStatus { UNINITIALIZED, INITIALIZED, FAULTY }

    // TODO: Expose some of these variables with getters?
    // Link(confirmer X, Block A) => block B, which A extends (confirms) (e.g. chain: A -> B -> C)
    // Link(this, A) is filled only if A is finalized according to this contract;
    // Link(X, A) is filled if A is confirmed by X;
    mapping(bytes => BlockId)   internal    _backlinks;
    // Link(confirmer X, block A) => block which extends (confirms) A (e.g. B in chain: C -> B -> A)
    // Link(this, A) => B: is only stored if A is extended by B and B is finalized;
    // Link(X, A) => B: is stored if A is extended by B and B is confirmed by X;
    mapping(bytes => BlockId)   internal    _forwardLinks;
    // Like forwardLinks but stores alternative forks
    mapping(bytes => BlockId[]) internal    _conflictForwardLinks;
    ConfirmerSet                internal    _confirmers;
    CId                         internal    _confirmerSetId;
    mapping(address => ConfirmerStatus)     _confirmerStatus;
    // Last finalized block
    BlockId  internal                       _head;
    bool                        internal    _fault = false;

    // TODO: constructor

    // TODO: Confirm function for external accounts
    // sender can be anyone but check that header contains valid signature
    // of account specified.
    function confirm(BlockHeader calldata header) external returns(bool) {
        return _confirm(header, msg.sender);
    }

    function extConfirm(
        BlockHeader calldata header,
        address signatory,
        uint8 sigIndex
    )
        external
        returns(bool)
    {
        require(FirmChainAbi.verifyBlockSig(header, sigIndex, signatory));
        return _confirm(header, signatory);
    }

    function _confirm(BlockHeader calldata header, address confirmerAddr) private returns(bool) {
        require(header.code == address(this));
        require(!_fault, "Fault was detected");
        require(header.timestamp <= block.timestamp, "Timestamp cannot be ahead of current time");

        // TODO: Compute block id properly
        BlockId bId = BlockId.wrap(0);

        // Check if id not already confirmed by the sender
        // Note: this is not necessarily a fault by a sender, it might be
        // an attempted replay of senders block.
        require(
            !isConfirmedBy(bId, confirmerAddr),
            "Block already confirmed by this confirmer"
        );

        // Get id of the block this block extends and check if it is finalized;
        BlockId prevId = header.prevBlockId;
        require(
            isFinalized(prevId),
            "Block already finalized with different block"
        );

        // Get id of the block this block extends and check if sender
        //   has not already attempted to extend this block with some other. If so, mark him as faulty.
        // Note that we already checked that `header` block is not yet confirmed.
        //   Therefore whatever block is 
        if (isExtendedBy(prevId, confirmerAddr)) {
            _confirmerStatus[confirmerAddr] = ConfirmerStatus.FAULTY;
            _conflictForwardLinks[packedConfirmation(confirmerAddr, prevId)] = bId;
            emit ByzantineFault(getExtendingBlock(prevId, confirmerAddr), bId);
        }

        // Get id of the block this block extends and check if that block
        //   has not yet been extended with some other *finalized* block.
        //   If so, mark sender as faulty.
        if (isExtendedBy(prevId, address(this))) {
            _confirmerStatus[confirmerAddr] = ConfirmerStatus.FAULTY;
            _conflictForwardLinks[packedConfirmation(confirmerAddr, prevId)] = bId;
            emit ByzantineFault(getExtendingBlock(prevId, address(this)), bId);
        }

        // Store confirmation
        if (_confirmerStatus[confirmerAddr] != ConfirmerStatus.FAULTY) {
            _backlinks[packedConfirmation(msg.sender, bId)] = prevId;
            _forwardLinks[packedConfirmation(msg.sender, prevId)] = bId;
            return true;
        } else {
            return false;
        }
    }

    function finalize(Block calldata bl) external {
        // Already checked `code` and `timestamp` in confirm

        // Check if it extends head (current LIB)
        // It has to be current head (LIB) because we don't allow even confirming
        // non-finalized blocks (so it cannot be some block previous to _head).
        BlockId prevId = bl.header.prevBlockId;
        require(BlockId.unwrap(prevId) == BlockId.unwrap(_head), "Previous block has to be current _head");

        // Call verifySignature (which does nothing by default)
        require(verifySignature(bl.header), "Block must be signed");

        require(verifyBlockDataId(bl), "Passed block body does not match header.blockDataId");

        // Go through current confirmers and count their confirmation weight
        // TODO: Compute block id from header
        BlockId bId = BlockId.wrap(0);
        uint16 sumWeight = 0; 
        for (uint i = 0; i < _confirmers.length; i++) {
            Confirmer memory c = _confirmers[i];
            if (isConfirmedBy(bId, c.addr)) {
                sumWeight += c.weight;
            }
        }
        // TODO: Make sure that default initial weight allows this to pass
        require(sumWeight >= _threshold, "Not enough confirmations");

        execute(bl);

        // TODO: Check that current _confirmerSetId matches confirmerSetId specified in the block

        this.confirm(bl.header);

        _head = bId;

        for (uint i = 0; i < bl.confirmedBl.length; i++) {
            IFirmChain code = IFirmChain(bl.confirmedBl[i].code);
            // TODO: Catch throws and issue events about that (FailedExternalConfirm)
            code.confirm(bl.header);
        }
    }

    function proveFault(
        Block calldata b1,
        ConfirmerSet   confirmers,
        Block calldata b2
    )
        external
    {
        // TODO:
        // * Calculate hash of confirmers (id);
        // * Check id is as specified in b1;
        // * Check that b1 is finalized;
        // * Calculate id of b2;
        // * Check if b1 is extended with finalized block other than b2
        // * Check that either _conflictForwardLinks or _forwardLinks have enough confirmations for b2 (confirmer, b1) -> b2
        // * Mark _fault = true
        // * Emit event

    }

    // This function should not access any external state,
    // so that if confirmers executed executed successfully before confirming, 
    // it would execute successfully on any other platform as well.
    function execute(Block calldata bl) internal virtual {
        // TODO: 
        // * parse commands from blockData
        // * Parse SET_CONFIRMER_SET command
        // * Call setConfirmerSet appropriately

    }

    function setConfirmerSet(ConfirmerSet calldata set) internal virtual {
        // TODO: 
        // * verify that confirmer set is valid
        // * Update _confirmerSet
        // * Update _confirmerSetId
    }


    function verifyBlockDataId(Block calldata bl) public pure returns(bool) {
        // TODO: compute hash of (bl.timestamp, bl.confirmedBl, bl.blockData)
        // TODO: check if computed hash matches the one declared in bl.header.blockDataId
    }

    function verifySignature(BlockHeader calldata header) internal virtual returns(bool) {}

    function packLink(Link calldata c) public pure returns(bytes memory) {
        return abi.encodePacked(c.confirmer, c.blockId);
    }

    function packedConfirmation(address confirmer, BlockId bId) public pure returns(bytes memory) {
        return abi.encodePacked(confirmer, bId);
    }

    function getExtendingBlock(BlockId blockId, address confirmer) public view returns(BlockId) {
        return _forwardLinks[packedConfirmation(confirmer, blockId)];
    }

    function isExtendedBy(BlockId blockId, address confirmer) public view returns(bool) {
        return BlockId.unwrap(getExtendingBlock(blockId, confirmer)) != 0;
    }

    function getExtendedBlock(BlockId confirmingBlock, address confirmer) public view returns(BlockId) {
        return _backlinks[packedConfirmation(confirmer, confirmingBlock)];

    }

    function isConfirmedBy(BlockId blockId, address confirmer) public view returns(bool) {
        return BlockId.unwrap(getExtendedBlock(blockId, confirmer)) != 0;
    }

    function isFinalized(BlockId blockId) public view returns(bool) {
        return isConfirmedBy(blockId, address(this));
    }



}