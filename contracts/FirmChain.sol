// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

interface IFirmChain {

    /// Content identifier (hash)
    type CId is bytes32;
    type BlockId is bytes32;

    // TODO: Implement ability to move to different address (this contract should be stopped and refer to the new address)

    struct BlockHeader {
        address         code;
        BlockId         prevBlockId;
        CId             blockDataId;
        bytes           attachments; // e.g.: signature
    }

    struct Block {
        BlockHeader   header;
        uint          timestamp;
        BlockHeader[] confirmedBl;
        bytes         blockData;
    }

    // TODO: Document

    function confirm(BlockHeader calldata header) external returns(bool);

    /// Fails on failure to finalize
    function finalize(Block calldata bl) external;
}



contract FirmChain is IFirmChain {

    event ByzantineFault(BlockId conflictB1, BlockId conflictB2);

    struct Link {
        address confirmer;
        BlockId blockId;
    }

    enum ConfirmerStatus { UNINITIALIZED, INITIALIZED, FAULTY }

    struct Confirmer {
        address addr;
        string name;
        uint8  weight;
        ConfirmerStatus status;
    }

    uint8 internal                        _threshold;
    Confirmer[] internal                  _confirmers;
    // Link(confirmer X, Block A) => block B, which A extends (confirms) (e.g. chain: A -> B -> C)
    // Link(this, A) is filled only if A is finalized according to this contract;
    // Link(X, A) is filled if A is confirmed by X;
    mapping(bytes => BlockId) internal    _backlinks;
    // Link(confirmer X, block A) => block which extends (confirms) A (e.g. B in chain: C -> B -> A)
    // Link(this, A) => B: is only stored if A is extended by B and B is finalized;
    // Link(X, A) => B: is stored if A is extended by B and B is confirmed by X;
    mapping(bytes => BlockId) internal    _forwardLinks;
    // Last finalized block
    BlockId internal                      _head;


    function confirm(BlockHeader calldata header) external returns(bool) {
        require(header.code == address(this));

        // Check if sender not already marked as faulty
        require(
            _confirmers[msg.sender].status != ConfirmerStatus.FAULTY,
            "Sender marked as faulty"
        );

        // TODO: Compute block id properly
        BlockId bId = BlockId.wrap(0);

        // Check if id not already confirmed by the sender
        // Note: this is not necessarily a fault by a sender, it might be
        // an attempted replay of senders block.
        require(
            !isConfirmedBy(bId, msg.sender),
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
        if (isExtendedBy(prevId, msg.sender)) {
            _confirmers[msg.sender].status = ConfirmerStatus.FAULTY;
            emit ByzantineFault(getExtendedBlock(prevId, msg.sender), bId);
            return false;
        }

        // Get id of the block this block extends and check if that block
        //   has not yet been extended with some other *finalized* block.
        //   If so, mark sender as faulty.
        if (isExtendedBy(prevId, address(this))) {
            _confirmers[msg.sender].status = ConfirmerStatus.FAULTY;
            emit ByzantineFault(getExtendingBlock(prevId, address(this)), bId);
            return false;
        }

        // Store confirmation
        _backlinks[packedConfirmation(msg.sender, bId)] = prevId;
        _forwardLinks[packedConfirmation(msg.sender, prevId)] = bId;

    }

    function finalize(Block calldata bl) external {
        require(bl.timestamp <= block.timestamp, "Timestamp cannot be ahead of current time");

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
        require(sumWeight >= _threshold, "Not enough confirmations");

        execute(bl);

        this.confirm(bl.header);

        _head = bId;

        for (uint i = 0; i < bl.confirmedBl.length; i++) {
            IFirmChain code = IFirmChain(bl.confirmedBl[i].code);
            // TODO: Catch throws and issue events about that (FailedExternalConfirm)
            code.confirm(bl.header);
        }
    }

    function execute(Block calldata bl) internal virtual {
        // TODO: 
        // * parse commands from blockData
        // * Parse ADD_CONFIRMER REMOVE_CONFIRMER, SET_THRESHOLD commands
        //    * These commands should take threshold parameter as well
        // * Call addConfirmer, removeConfirmer, setThreshold accordingly

    }

    function addConfirmer(Confirmer memory c) internal virtual {
        // TODO:
        // * Check if valid confirmer and threshold
        // * Store new confirmer
    }

    function setThreshold(uint8 newThreshold) internal virtual {
        // TODO:
        // * Check if valid new threshold;
        // * Store new threshold;
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

    // function isConfirmedBy(BlockId blockId, address confirmer) public view returns(bool) {
    //     return BlockId.unwrap(getConfirmingBlock(blockId, confirmer)) != 0;
    // }

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