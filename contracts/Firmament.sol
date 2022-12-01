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
    Firmament       firmamentCode;   /// Code for the next block
    Confirmer       confirmerCode;   /// Code for the next block
    address         selfChainId;     /// Address of the confirmerCode that started this chain TODO: Is this needed?
    BlockId         selfBlock;
    CId             opDataId;
    CId             stateId;
    uint            timestamp;
    Signature       sig;
}

struct Confirmation {
    address confirmer;
    BlockId confirmedBlock;
}

function packConfirmation(Confirmation calldata c) pure returns(bytes memory) {
    return abi.encodePacked(c.confirmer, c.confirmedBlock);
}

function packedConfirmation(address confirmer, BlockId confirmedBlock) pure returns(bytes memory) {
    return abi.encodePacked(confirmer, confirmedBlock);
}


interface Firmament {

    function confirm(Block calldata block) external returns(BlockId[] memory confirmedBlocks);

    function getHead(Confirmer chainId) external view returns (BlockId);

    function isBlockConfirmedBy(BlockId bid, Confirmer[] memory confirmers) external view returns(uint8[] memory mask);

    // TODO: getBlock, etc...
}

interface Confirmer {
    /// Assuming b1 is finalized, does b2 extend it and is finalized as well?
    /// If so return blockIds of additional blocks b2 confirms
    /// It also might want to make sure that state referenced in the new block is available. 
    function confirm(Block memory b1, Block memory b2) external returns(BlockId[] memory confirmedBlocks);
}

contract FirmamentV1 is Firmament {

    bytes32 constant FAULT = "FAULT";

    event ByzantineFault(BlockId conflictB1, BlockId conflictB2);

    mapping(BlockId => Block) _blocks; // finalized blocks
    mapping(Confirmer => BlockId) internal _heads; // latest finalized blocks
    // Confirmation(confirmer, confirmedBlock) => confirming block
    // Note that each chain should only confirm each other block at most once.
    // For a single chain confirming only its own blocks, confirming the same block
    // twice would mean a fork, which we don't tolerate here. For other cases it means
    // redundant confirmations.
    mapping(bytes => BlockId) internal _confirmations; 

    function confirm(Block calldata b) external goodTs(b) returns(BlockId[] memory confirmedBlocks) {
        // TODO: Calculate blockId and check if block is not already stored
        BlockId bId = BlockId.wrap(0);
        if (BlockId.unwrap(b.selfBlock) == 0) {
            // First block
            // TODO:
        } else {
            Block storage prev = _blocks[b.selfBlock];
            require(
                prev.firmamentCode == Firmament(this),
                "Previous block has to be finalized and refer to this contract"
            );

            require(prev.selfChainId == b.selfChainId, "Chain id does not match chain id specified in previous block");
            
            BlockId currHead = _heads[Confirmer(b.selfChainId)];
            // TODO: This comparison probably won't work
            require(BlockId.unwrap(currHead) != "FAULT", "Fault was detected on this chain (probably a fork)");

            require(b.confirmerCode != Confirmer(address(0)), "Confirmer code has to be specified");

            confirmedBlocks = b.confirmerCode.confirm(prev, b);
            // If error does not propagate, this means that b is considered finalized (as well as b.selfBlock)
            _blocks[bId] = b;
            // If b.selfBlock was already confirmed by b.chainId - that means a fork
            bytes memory confId = packedConfirmation(b.selfChainId, b.selfBlock);
            BlockId conf = _confirmations[confId];
            if (BlockId.unwrap(conf) != 0) {
                _heads[Confirmer(b.selfChainId)] = BlockId.wrap(FAULT);
                emit ByzantineFault(conf, bId);
                return confirmedBlocks;
            } else {
                _confirmations[confId] = bId; // confirmation of selfBlock
                for (uint i = 0; i < confirmedBlocks.length; i++) {
                    confId = packedConfirmation(b.selfChainId, confirmedBlocks[i]);
                    // TODO: This overrides previous confirmation by this chain.
                    // Should we check that and revert instead?
                    _confirmations[confId] = bId;
                }
                // If `b.selfBlock` is already finalized (which we check above by retrieving `prev`)
                // but not yet confirmed by `b.selfChainId` (which we check above as well), that means `b` extends current head.
                assert(BlockId.unwrap(_heads[Confirmer(b.selfChainId)]) == BlockId.unwrap(b.selfBlock));
                _heads[Confirmer(b.selfChainId)] = bId;
            }

        }
    }

    function getHead(Confirmer chainId) external view returns (BlockId) {
        // TODO: Check if not faulty?
        return _heads[chainId];
    }

    function isBlockConfirmedBy(BlockId bid, Confirmer[] memory confirmers) external view returns(uint8[] memory mask) {
        // TODO: implement on bits? Will it be cheaper?
        uint8[] memory m = new uint8[](confirmers.length);
        for (uint i = 0; i < confirmers.length; i++) {
            m[i] = BlockId.unwrap(_confirmations[packedConfirmation(address(confirmers[i]), bid)]) != 0 ? 1 : 0;
        }
        return m;
    }

    modifier goodTs(Block calldata bl) {
        require(bl.timestamp <= block.timestamp, "Block timestamp is later than current time");
        _;
    }


}