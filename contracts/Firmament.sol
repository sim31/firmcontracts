// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

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
    address         firmamentCode;   /// Code for the next block
    address         confirmerCode;   /// Code for the next block
    address         chainId;         // TODO: Is this needed?
    BlockId         selfPrevBlock;
    CId             opDataId;
    CId             stateId;
    uint            timestamp;
    Signature       sig;
}

struct Confirmation {
    Confirmer confirmer;
    BlockId confirmedBlock;
}

function packConfirmation(Confirmation calldata c) pure returns(bytes memory) {
    return abi.encodePacked(c.confirmer, c.confirmedBlock);
}

interface Firmament {

    function confirm(Block block) external returns(BlockId[] calldata confirmedBlocks);

    function getHead(address chainId) external view returns (BlockId);

    function isBlockConfirmedBy(BlockId bid, address[] memory chainIds) external view returns(bytes memory mask);

    // TODO: getBlock, etc...
}

interface Confirmer {
    function confirm(Block memory b1, Block memory b2) external returns(BlockId[] memory confirmedBlocks); 
}

contract FirmamentV1 is Firmament {

    bytes32 constant FAULT = "FAULT";

    mapping(BlockId => Block) _blocks; // finalized blocks
    mapping(Confirmer => BlockId) internal _heads;
    mapping(bytes => BlockId) internal _confirmations;

    function confirm(Block b) external goodTs(b) returns(BlockId[] calldata confirmedBlocks) {
        // TODO: Calculate blockId and check if block is not already stored
        if (b.selfPrevBlock == 0) {
            // First block
            // TODO:
        } else {
            Block prev = _blocks[b.selfPrevBlock];
            require(
                prev.firmamentCode == address(this),
                "Previous block has to be finalized and refer to this contract"
            );

            require(prev.chainId == b.chainId, "Chain id does not match chain id specified in previous block");
            
            BlockId currHead = _heads[b.chainId];
            // TODO: This probably won't work
            require(currHead != "FAULT", "Fault was detected on this chain (probably a fork)");

        }
    }

    function getHead(Confirmer chainId) external view returns (BlockId) {
        // TODO: Check if not faulty?
        return _heads[chainId];
    }

    function isBlockConfirmedBy(BlockId bid, Confirmer[] memory confirmers) external view returns(bytes memory mask) {
        // TODO:
    }

    modifier nonFaulty(Block calldata b) {

        require(!fault, "Fault detected (probably a fork in DeviceChain)");
        _;
    }

    modifier goodTs(Block calldata bl) {
        require(bl.timestamp <= block.timestamp, "Block timestamp is later than current time");
        _;
    }


}