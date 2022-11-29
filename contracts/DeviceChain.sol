// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChainAbi.sol";

contract DeviceChain is FirmChain {
    // TODO: Add object store to a separate library

    struct State {
        address owner;
    }

    mapping(CId => State) public states;
    /// Key is BlockId (hash of a block)
    mapping(BlockId => Block) public blocks;
    /// Key: confirmed block id, Value: id of a block which confirmed it
    mapping(BlockId => BlockId) public confirmations;
    BlockId internal _head; 
    bool public fault = false;

    function addBlock(Block calldata bl) external nonFaulty thisAddr(bl) goodTs(bl) returns (BlockId) {
        // Get current state
        Block storage headBl = blocks[_head];
        State storage currentState = states[headBl.stateId];

        require(FirmChainAbi.verifyBlockSig(bl, currentState.owner), "Block must be signed by owner");

        BlockId blockId = FirmChainAbi.getBlockId(bl);  
        
        blocks[blockId] = bl;

        return blockId;
    }

    function updateHead(BlockId blockId) external returns (BlockId) {

    }

    function getHead() external view returns (BlockId) {
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