// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "../node_modules/@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// Content identifier (hash)
type CId is bytes32;
type BlockId is bytes32;

using EnumerableSet for EnumerableSet.Bytes32Set;

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
}

struct Confirmer {
    address addr;
    uint8 weight;
}

struct ConfirmerSet {
    EnumerableSet.Bytes32Set _confirmers;
    uint8 _threshold;
}

struct BlockHeader {
    address code;
    BlockId prevBlockId;
    CId blockBodyId;
    uint timestamp;
    Signature[] sigs;
}

struct Block {
    BlockHeader header;
    CId confirmerSetId;
    // Data identified by blockDataId
    BlockHeader[] confirmedBl;
    bytes blockData;
}

struct Command {
    uint8 cmdId;
    bytes cmdData;
}

library FirmChainAbi {
    enum CommandIds {
        ADD_CONFIRMER,
        REMOVE_CONFIRMER,
        SET_CONF_THRESHOLD
    }

    function encode(
        BlockHeader calldata header
    ) public pure returns (bytes memory) {
        return abi.encode(header);
    }

    function getBlockId(
        BlockHeader calldata header
    ) public pure returns (BlockId) {
        bytes memory encoded = encode(header);
        return BlockId.wrap(keccak256(encoded));
    }

    function getConfirmerThreshold(
        ConfirmerSet storage confSet
    ) public view returns (uint8) {
        return confSet._threshold;
    }

    function packConfirmer(
        Confirmer calldata confirmer
    ) public pure returns (bytes32) {
        bytes32 r = bytes32(
            (uint256(uint160(confirmer.addr)) << 8) | confirmer.weight
        );
        return r;
    }

    function unpackConfirmer(bytes32 p) public pure returns (Confirmer memory) {
        uint8 weight = uint8(p[0]);
        address a = address(uint160(uint256(p) >> 8));
        return Confirmer(a, weight);
    }

    function getConfirmerSetId(
        ConfirmerSet storage confSet
    ) public view returns (CId) {
        return
            CId.wrap(
                keccak256(
                    abi.encodePacked(
                        confSet._threshold,
                        confSet._confirmers._inner._values
                    )
                )
            );
    }

    function getConfirmerSetId(
        Confirmer[] calldata confirmers,
        uint8 threshold
    ) public pure returns (CId) {
        bytes32[] memory packedConfs = new bytes32[](confirmers.length);
        for (uint i = 0; i < confirmers.length; i++) {
            packedConfs[i] = packConfirmer(confirmers[i]);
        }
        return CId.wrap(keccak256(abi.encodePacked(threshold, packedConfs)));
    }

    function confirmerAt(
        ConfirmerSet storage confSet,
        uint256 index
    ) public view returns (Confirmer memory) {
        bytes32 v = confSet._confirmers.at(index);
        return unpackConfirmer(v);
    }

    function confirmersLength(
        ConfirmerSet storage confSet
    ) public view returns (uint256) {
        return confSet._confirmers.length();
    }

    function updateConfirmerSet(
        ConfirmerSet storage confSet,
        Command memory cmd
    ) public returns (bool changed) {
        if (cmd.cmdId == type(uint8).max - uint8(CommandIds.ADD_CONFIRMER)) {
            require(
                confSet._confirmers.add(bytes32(cmd.cmdData)),
                "Confirmer already present"
            );
            return true;
        } else if (
            cmd.cmdId == type(uint8).max - uint8(CommandIds.REMOVE_CONFIRMER)
        ) {
            require(
                confSet._confirmers.remove(bytes32(cmd.cmdData)),
                "Confirmer is not present"
            );
            return true;
        } else if (
            cmd.cmdId == type(uint8).max - uint8(CommandIds.SET_CONF_THRESHOLD)
        ) {
            // Could check if sum weight of all confirmers reaches set threshold.
            // But this can be easily checked off-chain by each confirmer.
            confSet._threshold = abi.decode(cmd.cmdData, (uint8));
            return true;
        }
        return false;
    }

    function setConfirmerSet(
        ConfirmerSet storage confSet,
        Confirmer[] calldata confirmers,
        uint8 threshold
    ) public returns (CId) {
        for (uint i = 0; i < confirmers.length; i++) {
            confSet._confirmers.add(packConfirmer(confirmers[i]));
        }
        confSet._threshold = threshold;
        return getConfirmerSetId(confSet);
    }

    function getBlockBodyId(Block calldata bl) public pure returns (CId) {
        bytes memory encoded = abi.encode(
            bl.confirmerSetId,
            bl.confirmedBl,
            bl.blockData
        );
        return CId.wrap(keccak256(encoded));
    }

    function verifyBlockBodyId(Block calldata bl) public pure returns (bool) {
        CId realId = getBlockBodyId(bl);
        return CId.unwrap(bl.header.blockBodyId) == CId.unwrap(realId);
    }

    // For signing
    function getBlockDigest(
        BlockHeader calldata header
    ) public pure returns (bytes32) {
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

    function parseCommands(
        bytes calldata blockData
    ) public pure returns (Command[] memory) {
        Command[] memory cmds = abi.decode(blockData, (Command[]));
        return cmds;
    }

    function parseCommandsMem(
        bytes memory blockData
    ) public pure returns (Command[] memory) {
        Command[] memory cmds = abi.decode(blockData, (Command[]));
        return cmds;
        // return new Command[](0);
    }

    function verifyBlockSig(
        BlockHeader calldata header,
        Signature calldata sig,
        address signer
    ) public pure returns (bool) {
        bytes32 digest = getBlockDigest(header);
        address sg = ecrecover(digest, sig.v, sig.r, sig.s);
        return sg == signer;
    }

    function verifyBlockSig(
        BlockHeader calldata header,
        uint8 sigIndex,
        address signer
    ) public pure returns (bool) {
        require(header.sigs.length > sigIndex);
        return verifyBlockSig(header, header.sigs[sigIndex], signer);
    }

    function equalCId(CId c1, CId c2) public pure returns (bool) {
        return CId.unwrap(c1) == CId.unwrap(c2);
    }

    function equalBIds(BlockId i1, BlockId i2) public pure returns (bool) {
        return BlockId.unwrap(i1) == BlockId.unwrap(i2);
    }
}
