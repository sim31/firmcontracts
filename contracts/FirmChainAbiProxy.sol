// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./FirmChainAbi.sol";

// For testing FirmChainAbi
contract FirmChainAbiProxy {
    function encode(BlockHeader calldata header) public pure returns (bytes memory) {
        return FirmChainAbi.encode(header);
    }

    function encodeConfirmer(
        Confirmer calldata confirmer
    ) public pure returns (bytes32) {
        return FirmChainAbi.encodeConfirmer(confirmer);
    }

    function encodeConfirmerMem(
        Confirmer memory confirmer
    ) public pure returns (bytes32) {
        return FirmChainAbi.encodeConfirmerMem(confirmer);
    }

    function decodeConfirmer(bytes32 p) public pure returns (Confirmer memory) {
        return FirmChainAbi.decodeConfirmer(p);
    }

    function getBlockId(
        BlockHeader calldata header
    ) public pure returns (bytes32) {
        return FirmChainAbi.getBlockId(header);
    }

    function getConfirmerSetId(
        Confirmer[] calldata confirmers,
        uint8 threshold
    ) public pure returns (bytes32) {
        return FirmChainAbi.getConfirmerSetId(confirmers, threshold);
    }

    function encodeBlockBody(Message[] calldata calls) public pure returns(bytes memory) {
        return FirmChainAbi.encodeBlockBody(calls);
    }

    function getBlockBodyId(Block calldata bl) public pure returns (bytes32) {
        return FirmChainAbi.getBlockBodyId(bl);
    }

    function verifyBlockBodyId(Block calldata bl) public pure returns (bool) {
        return FirmChainAbi.verifyBlockBodyId(bl);
    }

    // // For signing
    function getBlockDigest(
        BlockHeader calldata header
    ) public pure returns (bytes32) {
        return FirmChainAbi.getBlockDigest(header);
    }

    function getSig(BlockHeader calldata header, uint8 sigIndex) public pure returns(Signature memory) {
        return FirmChainAbi.getSig(header, sigIndex);
    }

    function verifySigInBlock(
        BlockHeader calldata header,
        uint8 sigIndex,
        address signer
    ) public pure returns (bool) {
        return FirmChainAbi.verifySigInBlock(header, sigIndex, signer);
    }

}