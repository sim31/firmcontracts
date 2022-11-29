// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./FirmChain.sol";

// Thanks to: https://solidity-by-example.org/signature/

library FirmChainAbi {

    function encode(FirmChain.Block calldata bl) public view returns (bytes memory) {
        return abi.encodePacked(
            bl.code,
            bl.parentBlock,
            bl.selfBlock,
            bl.childBlock,
            bl.opDataId,
            bl.stateId,
            bl.timestamp,
            bl.sig.r,
            bl.sig.s,
            bl.sig.v
        );
    }

    function getBlockId(FirmChain.Block calldata bl) public view returns (FirmChain.BlockId) {
        // TODO: Generate IPFS hash
        // hash(encode(bl))
        return FirmChain.BlockId.wrap(0);
    }

    // For signing
    function getBlockDigest(FirmChain.Block calldata bl) public view returns (bytes32) {
        bytes memory encoded = abi.encodePacked(
            bl.code,
            bl.parentBlock,
            bl.selfBlock,
            bl.childBlock,
            bl.opDataId,
            bl.stateId,
            bl.timestamp,
            "",
            "",
            uint8(0)
        );
        // TODO: Generate IPFS hash;
        return 0;
    }

    function verifyBlockSig(FirmChain.Block calldata bl, address signer)
        public
        view
        returns (bool)
    {
        bytes32 digest = getBlockDigest(bl);
        address sg = ecrecover(digest, bl.sig.v, bl.sig.r, bl.sig.s);
        return sg == signer;
    }

}