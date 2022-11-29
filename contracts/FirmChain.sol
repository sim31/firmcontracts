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

    /// AKA "confirmation"
    struct Block {
        address         code;
        BlockId         parentBlock;
        BlockId         selfBlock;
        BlockId         childBlock;
        CId             opDataId;
        CId             stateId;
        uint            timestamp;
        Signature       sig;
    }

    function addBlock(Block calldata bl) external returns (BlockId);

    function updateHead(BlockId blockId) external returns (BlockId);

    function getHead() external view returns (BlockId);

}