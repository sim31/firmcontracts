// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChain.sol";

contract StateChain is FirmChain {

    enum CommandId{ SET_STATE } 

    bytes32 public stateRoot;

    constructor(Block memory genesisBl) FirmChain(genesisBl) {}

    function handleCommand(Block calldata bl, Command memory cmd) internal override returns(bool handled) {
        if (CommandId(cmd.cmdId) == CommandId.SET_STATE) {
            stateRoot = abi.decode(cmd.cmdData, (bytes32));                        
            return true;
        } else {
            return false;
        }
    }

}