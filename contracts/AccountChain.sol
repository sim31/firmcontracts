// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChainAbi.sol";

contract AccountChain is FirmChain {
    // TODO: Add object store to a separate library

    struct Device {
        string name;
        FirmChain addr;
        uint8 weight;
    }

    struct State {
        CId[] devices;
        uint8 threshold;
    }
    event ByzantineFault(BlockId conflictB1, BlockId conflictB2);

    mapping(CId => State) public states;
    mapping(CId => Device) public devices;
    /// Key is BlockId (hash of a block)
    mapping(BlockId => Block) public blocks;
    /// Key: confirmed block id, Value: id of a block which confirmed it
    mapping(BlockId => BlockId) public confirmations;
    BlockId internal _head; 
    bool public fault = false;

    function addBlock(Block calldata bl) external nonFaulty thisAddr(bl) goodTs(bl) returns (BlockId) {
        // Check if block not stored already
        BlockId blockId = FirmChainAbi.getBlockId(bl);  
        require(blocks[blockId].code == address(0), "Block already stored");

        // Get current state
        Block storage headBl = blocks[_head];
        State storage currentState = states[headBl.stateId];
        require(currentState.owner != address(0), "State is not added (use addState)");

        require(FirmChainAbi.verifyBlockSig(bl, currentState.owner), "Block must be signed by owner");

        // Forks are not allowed
        BlockId confirmingId = confirmations[bl.selfBlock];
        if (BlockId.unwrap(confirmingId) != 0) {
            fault = true;
            emit ByzantineFault(confirmingId, blockId);
        } else {
            confirmations[bl.selfBlock] = blockId;
        }
        
        blocks[blockId] = bl;

        return blockId;
    }

    function updateHead(BlockId blockId) external nonFaulty returns (BlockId) {
        BlockId confirmingId = confirmations[_head];
        require(BlockId.unwrap(confirmingId) != BlockId.unwrap(blockId), "This block does not confirm LIB");
        _head = blockId;
    }

    function addBlockAndUpdate(Block calldata bl) external returns (BlockId) {
        BlockId id = this.addBlock(bl);
        this.updateHead(id);
    }

    function addState(State calldata st) external nonFaulty {
        // TODO: Get state Cid, store state if it is not already there
    }

    function getLIB() external view returns (BlockId) {
        return _head;
    }

    modifier nonFaulty {
        require(!fault, "Fault detected (probably a fork in DeviceChain)");
        _;
    }

    modifier thisAddr(Block calldata bl) {
        require(bl.code == address(this), "Block addressed to a different contract");
        _;
    }

    modifier goodTs(Block calldata bl) {
        require(bl.timestamp <= block.timestamp, "Block timestamp is later than current time");
        _;
    }

    // TODO: Is it needed?
    // function removeBlock

}