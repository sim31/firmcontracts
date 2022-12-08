// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChainAbi.sol";

interface IFirmChain {

    // TODO: Document

    function confirm(BlockHeader calldata header) external returns(bool);

    // Confirmation from an external account
    // header has to contain a sign
    function extConfirm(
        BlockHeader calldata header,
        address signatory,
        uint8 sigIndex
    ) 
        external 
        returns(bool);

    /// Fails on failure to finalize
    function finalize(Block calldata bl) external;
}