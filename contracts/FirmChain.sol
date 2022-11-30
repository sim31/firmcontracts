// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

interface FirmChain {

    /// Content identifier (hash)
    type CId is bytes32;
    type BlockId is bytes32;

    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8   v;
    }

    // TODO: There should probably be a standard way to calculate childBlocksId 
    //       Simply a hash of a list or a merkle tree? If you will eve
    /// AKA "confirmation"
    struct Block {
        address         code;
        BlockId         parentBlock;
        BlockId         selfBlock;
        CId             childBlocksId;
        CId             opDataId;
        CId             stateId;
        uint            timestamp;
        Signature       sig;
    }

    function addBlock(Block calldata bl) external returns (BlockId);

    function updateHead(BlockId blockId) external returns (BlockId);

    function addBlockAndUpdate(Block calldata bl) external returns (BlockId);

    /// Returns last irreversible block
    function getLIB() external view returns (BlockId);

}