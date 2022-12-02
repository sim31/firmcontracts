// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

// TODO:
// * Store block numbers;
// * Allow confirmers to limit what can confirm them (or pass block numbers of confirmations);
// * Try to avoid storing blocks. Pass blocks through calldata. You only need blocks which this block confirms I think;
    // * Better - have saveBlock function but also allow passing all blocks through calldata
// * Remove selfBlock - self confirmations should work as normal confirmations;
// * Check:
//   * Address cannot confirm the same block twice (almost checking that already)
//   * Address cannot confirm a block of address A, if that block confirming a block at address A which is already confirmed
//   * If these checks fail you should mark the address that does that as byzantine;
// * Confirmers should only be allowed access to confirmation data about blocks that confirm them;
// * Confirmers you implement should check if they are called by known firmament contract and only then proceed;
// * Account and Fractal confirmers should store only a current state as a normal DAO would and reject blocks which are historical
    // * Maybe write an explanation for that kind of behaviour;
// * Remove sig from Block structure. If signature is needed it should be put in opDataId and it should sign previous blockId
// * Remove stateId - if something like this is needed it can be added to opData
// * Rename opDataId to dataId (block data id);
// * Remove timestamp. You can save a lot this way and people can still add it to block data

/// Content identifier (hash)
type CId is bytes32;
type BlockId is bytes32;

// TODO: Move signature to where it is relevant
struct Signature {
    bytes32 r;
    bytes32 s;
    uint8   v;
}

// 92 bytes
struct BlockHeader {
    Firmament       firmamentCode;   /// Code for the next block
    Confirmer       confirmerCode;   /// Code for the next block
    Confirmer       selfChainId;     /// Address of the confirmerCode that started this chain TODO: Is this needed?
    CId             blockDataId;
}

struct Block {
    BlockHeader header;
    bytes       blockData;
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

    function confirm(
        BlockId id,
        Block[] calldata blocks
    )
        external
        returns(BlockId[] memory confirmedBlocks);

    function confirm(
        Block[] calldata blocks
    )
        external
        returns(BlockId[] memory confirmedBlocks);
    
    function saveBlock(Block calldata block) external;

    function getHead(Confirmer chainId) external view returns (BlockId);

    // This has to check that the caller is confirmer which is currently being confirmed
    function isBlockConfirmedBy(BlockId bid, Confirmer[] memory confirmers) external view returns(uint8[] memory mask);

    // TODO: getBlock, etc...
}

interface Confirmer {
    // TODO: Pass only blocks which are being confirmed
    // TODO: Document better
    /// Assuming b1 is finalized, does b2 extend it and is finalized as well?
    /// If so return blockIds of additional blocks b2 confirms
    /// It also might want to make sure that state referenced in the new block is available. 
    /// confirmerData is any data that can help confirmer confirmer. Most obvious use case
    /// is to pass opData and/or states that stateId and opDataIds refer to in blocks.
    /// But this is not necessary - confirmerData could be empty array of bytes
    /// Confirmer could for example not have any state or have it stored earlier.
    function confirm(Block memory b1, Block[] memory blocks)
        external returns(BlockId[] memory confirmedBlocks);
}

contract FirmamentV1 is Firmament {

    bytes32 constant FAULT = "FAULT";

    event ByzantineFault(BlockId conflictB1, BlockId conflictB2);

    struct BlockHeight {
        uint64  height;
        BlockId id;
    }

    mapping(BlockId => Block) _blocks; // block store
    // Confirmer heare is chain id (initial confirmer that started the chain)
    mapping(Confirmer => BlockId) internal _heads; // latest finalized blocks
    // Confirmation(confirmer, confirmedBlock) => confirming block
    // Note that each chain should only confirm each other block at most once.
    // For a single chain confirming only its own blocks, confirming the same block
    // twice would mean a fork, which we don't tolerate here. For other cases it means
    // redundant confirmations.
    // TODO: Maybe you can store only height here?
    mapping(bytes => BlockHeight) internal _confirmations; 

    function confirm(Block calldata b, bytes calldata confirmerData) 
        external
        goodTs(b)
        returns(BlockId[] memory confirmedBlocks)
    {
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

            confirmedBlocks = b.confirmerCode.confirm(prev, b, confirmerData);
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