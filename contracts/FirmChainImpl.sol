// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./FirmChainAbi.sol";
import "hardhat/console.sol";

struct Link {
    address confirmer;
    bytes32 blockId;
}

enum ConfirmerStatus {
    UNINITIALIZED,
    INITIALIZED,
    FAULTY
}

enum ConfirmerOpId {
    ADD,
    REMOVE
}

struct ConfirmerOp {
    ConfirmerOpId opId;
    Confirmer conf;
}

library FirmChainImpl {
    event ByzantineFault(address source, bytes32 forkPoint);
    event WrongConfirmerSetId(bytes32 blockId);
    event ExternalCall(bytes retValue);
    event ExternalCallFail(bytes retValue);
    event ContractDoesNotExist(address addr);

    using FirmChainAbi for ConfirmerSet;
    using FirmChainAbi for Block;
    using FirmChainAbi for BlockHeader;

    struct FirmChain {
        // TODO: Expose some of these variables with getters?
        // Link(confirmer X, Block A) => block B, which A extends (confirms) (e.g. chain: A -> B -> C)
        // Link(this, A) is filled only if A is finalized according to this contract;
        // Link(X, A) is filled if A is confirmed by X;
        mapping(bytes => bytes32) _backlinks;
        // Link(confirmer X, block A) => block which extends (confirms) A (e.g. B in chain: C -> B -> A)
        // Link(this, A) => B: is only stored if A is extended by B and B is finalized;
        // Link(X, A) => B: is stored if A is extended by B and B is confirmed by X;
        mapping(bytes => bytes32) _forwardLinks;
        // Like forwardLinks but stores alternative forks
        mapping(bytes => bytes32[]) _conflictForwardLinks;
        bytes32 _confirmerSetId;
        ConfirmerSet _confirmerSet;
        mapping(address => ConfirmerStatus) _confirmerStatus;
        // Last finalized block and executed block
        // If last block is only finalized but not executed,
        // its id will be in backlinks and in forwardLinks stored appropriately,
        // but not set as _head.
        bytes32 _head;
        bool _fault;
    }

    // Expected to be called by constructor of the IFirmChain
    function construct(
        FirmChain storage chain,
        Block calldata genesisBl,
        ConfirmerOp[] calldata confirmerOps,
        uint8 threshold
    ) 
        external 
        goodTs(genesisBl.header.timestamp)
    {
        require(
            chain._head == 0,
            "Chain already initialized"
        );
        require(
            genesisBl.header.prevBlockId == 0,
            "prevBlockId has to be set to 0 in genesis block"
        );
        require(
            genesisBl.verifyBlockBodyId(),
            "Passed block body does not match header.blockBodyId"
        );
        require(
            genesisBl.confirmerSetId != 0,
            "Confirmer set has to be set"
        );

        _updateConfirmerSet(chain, confirmerOps, threshold);

        bytes32 bId = FirmChainAbi.getBlockId(genesisBl.header);
        // IMPORTANT: You should not have external calls to yourself here
        // NOTE: if you delete this call here, then you should do a check on confirmerSetId elsewhere
        _execute(chain, genesisBl, bId);

        chain._backlinks[packedLink(address(this), bId)] = "1";
        chain._head = bId;
    }

    // This must be called from contract (account with code set).
    // If confirmations from externally-owned accounts would be allowed here,
    // then people could use this function to confirm on ethereum, but that
    // confirmation would not be exportable (because it is an ethereum tx).
    // This could result in a fork.
    // The fact that it is a contract does not protect from the same situation,
    // but a DAO can make sure that confirmer contracts are not dependent on any state that could cause trouble like this.
    function confirm(FirmChain storage chain, BlockHeader calldata header) external notFromSelf fromContract returns (bool) {
        return _confirm(chain, header, msg.sender);
    }

    // sender can be anyone but check that header contains valid signature
    // of account specified.
    function extConfirm(
        FirmChain storage chain,
        BlockHeader calldata header,
        address signatory,
        Signature calldata sig
    ) external returns (bool) {
        require(header.verifyBlockSig(sig, signatory), "Invalid signature");
        return _confirm(chain, header, signatory);
    }

    function finalize(FirmChain storage chain, BlockHeader calldata header) external notFromSelf {
        bytes32 bId = header.getBlockId();
        _finalize(chain, header, bId);
    }

    function finalizeAndExecute(FirmChain storage chain, Block calldata bl) external notFromSelf {
        bytes32 bId = bl.header.getBlockId();
        _finalize(chain, bl.header, bId);
        _executeNext(chain, bl, bId);
    }

    function execute(FirmChain storage chain, Block calldata bl) external notFromSelf {
        bytes32 bId = bl.header.getBlockId();
        _executeNext(chain, bl, bId);
    }

    function updateConfirmerSet(
        FirmChain storage chain,
        ConfirmerOp[] calldata ops,
        uint8 threshold
    ) external fromSelf {
        _updateConfirmerSet(chain, ops, threshold);
    }

    function _updateConfirmerSet(
        FirmChain storage chain,
        ConfirmerOp[] calldata ops,
        uint8 threshold
    ) private {
        for (uint i = 0; i < ops.length; i++) {
            if (ops[i].opId == ConfirmerOpId.REMOVE) {
                require(
                    chain._confirmerSet.removeConfirmer(ops[i].conf),
                    "Can only remove existing confirmer"
                );
            } else if (ops[i].opId == ConfirmerOpId.ADD) {
                require(
                    chain._confirmerSet.addConfirmer(ops[i].conf),
                    "Cannot add a confirmer which is already there"
                );
            }
        }
        chain._confirmerSet.setConfirmerThreshold(threshold);

        chain._confirmerSetId = chain._confirmerSet.getConfirmerSetId();
    }

    function _confirm(
        FirmChain storage chain,
        BlockHeader calldata header,
        address confirmerAddr
    ) private nonFaulty(chain) goodTs(header.timestamp) returns (bool) {
        bytes32 bId = header.getBlockId();

        // Check if id not already confirmed by the sender
        // Note: this is not necessarily a fault by a sender, it might be
        // an attempted replay of senders block.
        require(
            !isConfirmedBy(chain, bId, confirmerAddr),
            "Block already confirmed by this confirmer"
        );

        // Get id of the block this block extends and check if it is finalized;
        bytes32 prevId = header.prevBlockId;
        require(isFinalized(chain, prevId), "Previous block has to be finalized.");

        // Get id of the block this block extends and check if sender
        //   has not already attempted to extend this block with some other. If so, mark him as faulty.
        // Note that we already checked that `header` block is not yet confirmed.
        //   Therefore whatever block is extending `prevId`, it is not `header`
        if (isExtendedBy(chain, prevId, confirmerAddr)) {
            _confirmerFault(chain, confirmerAddr, prevId, bId);
        }

        // Get id of the block this block extends and check if that block
        //   has not yet been extended with some other *finalized* block.
        //   If so, mark sender as faulty.
        if (isExtendedBy(chain, prevId, address(this))) {
            _confirmerFault(chain, confirmerAddr, prevId, bId);
        }

        // Store confirmation
        if (chain._confirmerStatus[confirmerAddr] != ConfirmerStatus.FAULTY) {
            chain._backlinks[packedLink(confirmerAddr, bId)] = prevId;
            chain._forwardLinks[packedLink(confirmerAddr, prevId)] = bId;
            return true;
        } else {
            return false;
        }
    }


    function _finalize(FirmChain storage chain, BlockHeader calldata header, bytes32 bId) nonFaulty(chain) private {
        // Already checked `timestamp` in confirm

        // Check if it extends head (current LIB)
        // It has to be current head (LIB) because we don't allow even confirming
        // non-finalized blocks (so it cannot be some block previous to _head).
        // Note that this will also fail if previous block is the latest but not yet executed.
        bytes32 prevId = header.prevBlockId;
        require(
            prevId == chain._head,
            "Previous block has to be current _head"
        );

        // Go through current confirmers and count their confirmation weight
        uint16 sumWeight = 0;
        for (uint i = 0; i < chain._confirmerSet.confirmersLength(); i++) {
            Confirmer memory c = chain._confirmerSet.confirmerAt(i);
            if (isConfirmedBy(chain, bId, c.addr)) {
                sumWeight += c.weight;
            }
        }
        require(
            sumWeight >= chain._confirmerSet.getConfirmerThreshold(),
            "Not enough confirmations"
        );

        // Mark this block as confirmed by `this` (means block is finalized)
        require(_confirm(chain, header, address(this)));
    }


    function _executeNext(FirmChain storage chain, Block calldata bl, bytes32 bId) nonFaulty(chain) private {
        require(
            bl.verifyBlockBodyId(),
            "Passed block body does not match header.blockDataId"
        );

        // If chain._head is extended it means that the block which extends it is finalized but not executed.
        // Once extending block is executed it will become chain._head (see end of `_execute` function).
        require(
            getExtendingBlock(chain, chain._head, address(this)) == bId,
            "You can only execute a block which extends the current head block and is not executed yet."
        );

        _execute(chain, bl, bId);
    }

    function _execute(FirmChain storage chain, Block calldata bl, bytes32 bId) private {
        for (uint8 i = 0; i < bl.msgs.length; i++) {
            Message calldata c = bl.msgs[i];
            if (isContract(c.addr)) {
                // We don't revert if these calls fail.
                // But note that all available gas is passed.
                // So in case of out of gas exception this transaction should revert as well.
                (bool success, bytes memory retVal) = c.addr.call(c.cdata);
                if (success) {
                    // console.log("External call");
                    emit ExternalCall(retVal);
                } else {
                    // console.log("External call fail");
                    emit ExternalCallFail(retVal);
                }
            } else {
                // console.log("Contract does not exist");
                emit ContractDoesNotExist(c.addr);
            }
        }

        // Either confirmers confirmed a block in which declared confirmerSetId does not match
        // confirmer set resulting from operations (confirmer add remove, etc) in a block or
        // call to perform these operations failed above. Either way next block won't
        // be finalizible until this is resolved (because _finalize requires previous block to be _head, which is only set below this require).
        // Note that it is not resolvable in the first case (bad declared confirmerSetId).
        if (chain._confirmerSetId != bl.confirmerSetId) {
            console.log("chain confId: ", uint256(chain._confirmerSetId));
            console.log("header confId: ", uint256(bl.confirmerSetId));
        }
        require(
            chain._confirmerSetId == bl.confirmerSetId,
            "Confirmer set computed does not match declared"
        );

        chain._head = bId;
    }

    function proveFault(
        FirmChain storage chain,
        Block calldata b1,
        Confirmer[] calldata confirmers,
        uint8 threshold,
        Block calldata b2
    ) external nonFaulty(chain) {
        // * Calculate hash of passed confirmer set (id);
        bytes32 confId = FirmChainAbi.getConfirmerSetId(confirmers, threshold);
        // * Check id is as specified in b1;
        require(confId == b1.confirmerSetId);
        // * Check that b1 is finalized;
        bytes32 b1Id = b1.header.getBlockId();
        require(isFinalized(chain, b1Id));
        // * Calculate id of b2;
        bytes32 b2Id = b2.header.getBlockId();
        // * Check if b1 is extended with finalized block other than b2
        bytes32 altId = getExtendingBlock(chain, b1Id, address(this));
        require(altId != b2Id);
        // * Check that either _conflictForwardLinks and _forwardLinks have enough confirmations for b2 (confirmer, b1) -> b2
        uint16 sumWeight = 0;
        for (uint i = 0; i < confirmers.length; i++) {
            Confirmer memory c = confirmers[i];
            if (
                isConfirmedBy(chain, b2Id, c.addr) ||
                conflConfirmationExists(chain, b1Id, b2Id, c.addr)
            ) {
                sumWeight += c.weight;
            }
        }
        require(sumWeight >= threshold);
        // * Mark this chain as faulty
        chain._fault = true;
        // * Emit event
        emit ByzantineFault(address(this), b1Id);
    }

    function _confirmerFault(
        FirmChain storage chain,
        address confirmer,
        bytes32 prevId,
        bytes32 nextId
    ) private {
        chain._confirmerStatus[confirmer] = ConfirmerStatus.FAULTY;
        if (!conflConfirmationExists(chain, prevId, nextId, confirmer)) {
            chain._conflictForwardLinks[packedLink(confirmer, prevId)].push(nextId);
            emit ByzantineFault(confirmer, prevId);
        }
    }


    function packLink(Link calldata c) public pure returns (bytes memory) {
        return abi.encodePacked(c.confirmer, c.blockId);
    }

    function packedLink(
        address confirmer,
        bytes32 bId
    ) public pure returns (bytes memory) {
        return abi.encodePacked(confirmer, bId);
    }

    function getExtendingBlock(
        FirmChain storage chain,
        bytes32 blockId,
        address confirmer
    ) public view returns (bytes32) {
        return chain._forwardLinks[packedLink(confirmer, blockId)];
    }

    function isExtendedBy(
        FirmChain storage chain,
        bytes32 blockId,
        address confirmer
    ) public view returns (bool) {
        return getExtendingBlock(chain, blockId, confirmer) != 0;
    }

    function getExtendedBlock(
        FirmChain storage chain,
        bytes32 confirmingBlock,
        address confirmer
    ) public view returns (bytes32) {
        return chain._backlinks[packedLink(confirmer, confirmingBlock)];
    }

    function getConflExtendingIds(
        FirmChain storage chain,
        bytes32 prevId,
        address confirmer
    ) internal view returns (bytes32[] storage) {
        bytes32[] storage extendingIds = chain._conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        return extendingIds;
    }

    function conflConfirmationExists(
        FirmChain storage chain,
        bytes32 prevId,
        bytes32 nextId,
        address confirmer
    ) public view returns (bool) {
        bytes32[] storage confirmingIds = chain._conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        for (uint i = 0; i < confirmingIds.length; i++) {
            if (confirmingIds[i] == nextId) {
                return true;
            }
        }
        return false;
    }

    function conflConfirmationExists(
        FirmChain storage chain,
        bytes32 prevId,
        address confirmer
    ) public view returns (bool) {
        bytes32[] storage confirmingIds = chain._conflictForwardLinks[
            packedLink(confirmer, prevId)
        ];
        return confirmingIds.length > 0;
    }

    function isConfirmedBy(
        FirmChain storage chain,
        bytes32 blockId,
        address confirmer
    ) public view returns (bool) {
        return getExtendedBlock(chain, blockId, confirmer) != 0;
    }

    function isFinalized(FirmChain storage chain, bytes32 blockId) public view returns (bool) {
        return isConfirmedBy(chain, blockId, address(this));
    }

    function getConfirmers(FirmChain storage chain) public view returns (bytes32[] memory) {
        return chain._confirmerSet.getConfirmers();
    }

    function getThreshold(FirmChain storage chain) public view returns (uint8) {
        return chain._confirmerSet.getConfirmerThreshold();
    }

    function getHead(FirmChain storage chain) public view returns (bytes32) {
        return chain._head;
    }

    function isContract(address _addr) private view returns (bool){
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }

    modifier notFromSelf() {
        require(msg.sender != address(this), "This function cannot be called by contract itself");
        _;
    }

    modifier fromContract() {
        require(isContract(msg.sender), "Must be called from contract");
        _;
    }

    modifier fromSelf() {
        require(msg.sender == address(this), "This function can only be called by contract itself");
        _;
    }

    modifier goodTs(uint ts) {
        require(
            ts <= block.timestamp + 60, // +/- 1 minute
            "Timestamp is later than current time"
        );
        _;
    }

    modifier nonFaulty(FirmChain storage chain) {
        require(!chain._fault, "Fault was detected");
        _;
    }


}