// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./Firmament.sol";

contract DeviceConfirmer is Confirmer {
    // TODO: Add object store to a separate library

    struct State {
        address keyId;
    }

    struct OpData {
        BlockId confirmedParent;
    }

    mapping(CId => State) public states;

    // TODO: How should initial block work
    function confirm(Block memory b1, Block memory b2) external returns(BlockId[] memory confirmedBlocks) {
        // Extract these common checks to abstract class
        require(b1.confirmerCode == this, "Wrong confirmer");
        // TODO:
        BlockId b1Id = BlockId.wrap(0);
        require(BlockId.unwrap(b2.selfBlock) == BlockId.unwrap(b1Id), "b2.selfBlock has to be b1");
        require(b1.selfChainId == b2.selfChainId, "Chain id does not match chain id specified in previous block");

        State storage st1 = states[b1.stateId];
        State storage st2 = states[b2.stateId]; 
        require(st1.keyId != address(0) && st2.keyId != address(0), "Unknown state referenced by a block");
        
        // TODO: verify signature

        confirmedBlocks = new BlockId[](1); 
        confirmedBlocks[0] = getOpData(b2.opDataId);
        return confirmedBlocks;
    }


    function storeState(State calldata state) external {
        CId cid = getStateCid(state);
        states[cid] = state;        
    }

    /// OpData is just a blockId of confirmed block in the parent chain (or at least one of parent chains)
    function getOpData(CId opDataId) public pure returns(BlockId) {
        return BlockId.wrap(CId.unwrap(opDataId));
    }

    function getStateCid(State calldata state) public pure returns(CId) {
        // TODO: IPFS hash instead?
        return CId.wrap(keccak256(abi.encodePacked(state.keyId)));
    }

    // TODO: Is it needed?
    // function removeBlock

}