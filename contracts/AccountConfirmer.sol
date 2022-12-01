// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./Firmament.sol";

// TODO: Rename: multisig confirmer
contract AccountConfirmer is Confirmer {

    error LackOfChildConfirmations();
    error UnknownState(CId cid);
    error UnknownContent(CId cid, string contentType);

    // TODO: Add object store to a separate library
    struct Device {
        Confirmer chain;
        string name;
        uint8 weight;
    }

    struct State {
        CId[] devices;
        uint8 threshold;
    }
    mapping(CId => State) public states;
    mapping(CId => Device) public devices;

    // TODO: How should initial block work
    function confirm(Block memory b1, Block memory b2) external returns(BlockId[] memory confirmedBlocks) {
        // Extract these common checks to abstract class
        require(b1.confirmerCode == this, "Wrong confirmer");
        // TODO: Check if it is not the same block (b1, b2)
        // TODO:
        BlockId b1Id = BlockId.wrap(0);
        BlockId b2Id = BlockId.wrap(0);
        require(BlockId.unwrap(b1Id) != BlockId.unwrap(b2Id));
        require(BlockId.unwrap(b2.selfBlock) == BlockId.unwrap(b1Id), "b2.selfBlock has to be b1");
        require(b1.selfChainId == b2.selfChainId, "Chain id does not match chain id specified in previous block");

        // Checks if state and devices are not stored
        (State storage st1, Device[] memory devices1) = retrieveFullState(b1.stateId);
        if (CId.unwrap(b1.stateId) != CId.unwrap(b2.stateId)) {
            (State storage st2, Device[] memory devices2) = retrieveFullState(b2.stateId);
            verifyState(st2, devices2);
        }

        // Now we need to check if b2 is confirmed by individual devices
        Confirmer[] memory confirmers = getConfirmers(devices1);
        uint8[] memory confMask = b1.firmamentCode.isBlockConfirmedBy(b2Id, confirmers);
        uint16 sumWeight = 0;
        for (uint i = 0; i < confMask.length && sumWeight < st1.threshold; i++) {
            if (confMask[i] == 1) {
                sumWeight += devices1[i].weight;
            }
        }
        if (sumWeight < st1.threshold) {
            revert LackOfChildConfirmations();
        } else {
            confirmedBlocks = new BlockId[](1); 
            confirmedBlocks[0] = getOpData(b2.opDataId);
            return confirmedBlocks;
        }
    }

    /// This function assumes that passed devs are referenced in st.
    function verifyState(State storage st, Device[] memory devs) internal view {
        require(st.threshold > 0);
        uint256 weightSum = 0;
        for (uint i = 0; i < devs.length; i++) {
            weightSum += devs[i].weight;
        }
        require(weightSum >= st.threshold);
    }

    /// OpData is just a blockId of confirmed block in the parent chain (or at least one of parent chains)
    function getOpData(CId opDataId) public pure returns(BlockId) {
        return BlockId.wrap(CId.unwrap(opDataId));
    }

    function getConfirmers(Device[] memory devs) public pure returns(Confirmer[] memory) {
        Confirmer[] memory confirmers = new Confirmer[](devs.length);
        for (uint i = 0; i < devs.length; i++) {
            confirmers[i] = devs[i].chain;
        }
        return confirmers;
    }

    function deviceExists(CId cid) public view returns(bool) {
        return devNonEmpty(devices[cid]);
    }

    function stateExists(CId cid) public view returns(bool) {
        return stateNonEmpty(states[cid]);
    }

    function devNonEmpty(Device storage dev) internal view returns(bool) {
        return address(dev.chain) != address(0);
    }

    function stateNonEmpty(State storage st) internal view returns(bool) {
        return st.devices.length > 0;
    }

    function retrieveFullState(CId cid) internal view returns(State storage, Device[] memory) {
        State storage st = states[cid];
        if (!stateNonEmpty(st)) {
            revert UnknownState(cid);
        }
        Device[] memory devs = new Device[](st.devices.length);
        for (uint i = 0; i < st.devices.length; i++) {
            devs[i] = retrieveDevice(st.devices[i]);
        }
        return (st, devs);
    }

    function retrieveDevice(CId id) internal view returns(Device storage) {
        Device storage dev = devices[id];
        if (!devNonEmpty(dev)) {
            revert UnknownContent(id, "Device");
        }
        return dev;
    }

    function addDevice(Device calldata dev) external {
        CId id = getDeviceCId(dev);
        devices[id] = dev;
    }

    function addState(State calldata st) external {
        CId id = getStateCId(st);
        states[id] = st;
    }

    function getDeviceCId(Device calldata dev) public pure returns(CId) {
        // TODO: IPFS CID
        bytes memory encoded = abi.encode(dev);
        return CId.wrap(keccak256(encoded));
    }

    function getStateCId(State calldata st) public pure returns(CId) {
        return CId.wrap(keccak256(abi.encode(st)));
    }


    // TODO: Is it needed?
    // function removeBlock

}