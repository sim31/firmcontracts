// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/// Content identifier (hash)
type CId is bytes32;
type BlockId is bytes32;

// TODO: Implement ability to move to different address (this contract should be stopped and refer to the new address)

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8   v;
}

struct Confirmer {
    address addr;
    uint8  weight;
}

struct ConfirmerSet {
    Confirmer[] confirmers;
    uint8       threshold;
}

struct BlockHeader {
    address         code;
    BlockId         prevBlockId;
    CId             blockBodyId;
    uint            timestamp;
    Signature[]     sigs;
}

struct Block {
    BlockHeader   header;
    CId           confirmerSetId;
    // Data identified by blockDataId
    BlockHeader[] confirmedBl;
    bytes         blockData;
}

library FirmChainAbi {
    // TODO: Make pure?

    function encode(BlockHeader calldata header) public pure returns (bytes memory) {
        return abi.encode(header);
    }

    function getBlockId(BlockHeader calldata header) public pure returns(BlockId) {
        bytes memory encoded = encode(header);
        return BlockId.wrap(keccak256(encoded));
    }

    function getConfirmerSetId(ConfirmerSet calldata c) public pure returns(CId) {
        bytes memory encoded = abi.encode(c);
        return CId.wrap(keccak256(encoded));
    }

    function getBlockDataId(Block calldata bl) public pure returns(CId) {
        bytes memory encoded = abi.encode(bl.confirmerSetId, bl.confirmedBl, bl.blockData);
        return CId.wrap(keccak256(encoded));
    }

    function verifyBlockBodyId(Block calldata bl) public pure returns(bool) {
        CId realId = getBlockDataId(bl);
        return CId.unwrap(bl.header.blockBodyId) == CId.unwrap(realId);
    }

    // For signing
    function getBlockDigest(BlockHeader calldata header) public pure returns(bytes32) {
        // Like block id but without signatures
        bytes memory encoded = abi.encodePacked(
            header.code,
            header.prevBlockId,
            header.blockBodyId,
            header.timestamp
        );
        // TODO: Generate IPFS hash;
        return keccak256(encoded);
    }


    function verifyBlockSig(
        BlockHeader calldata header,
        Signature calldata sig,
        address signer
    )
        public
        pure
        returns(bool)
    {
        bytes32 digest = getBlockDigest(header);
        address sg = ecrecover(digest, sig.v, sig.r, sig.s);
        return sg == signer;
    }

    function verifyBlockSig(
        BlockHeader calldata header,
        uint8 sigIndex,
        address signer
    )
        public
        pure
        returns(bool)
    {
        require(header.sigs.length > sigIndex);
        return verifyBlockSig(header, header.sigs[sigIndex], signer);
    }

    function equalCId(CId c1, CId c2) public pure returns(bool) {
        return CId.unwrap(c1) == CId.unwrap(c2);
    }

    function equalBIds(BlockId i1, BlockId i2) public pure returns(bool) {
        return BlockId.unwrap(i1) == BlockId.unwrap(i2);
    }

}