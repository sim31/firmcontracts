// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./FirmChain.sol";
import "./IssuedNTT.sol";

contract EdenPlusFractal is FirmChain, IssuedNTT {
    struct BreakoutResults {
        address delegate;
        // From lowest (least contributed) to highest
        address[6] ranks;
    }

    bytes constant _rewards = hex"020305080D15";

    // Results of the last 4 weeks
    BreakoutResults[][4] public results;

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        string memory name,
        string memory symbol
    ) FirmChain(genesisBl, confirmerOps, threshold) IssuedNTT(name, symbol, address(this)) {}

    function submitResults(BreakoutResults[] calldata newResults) public fromSelf {
        results[3] = results[2];
        results[2] = results[1];
        results[1] = results[0];
        delete results[0];

        for (uint i = 0; i < results.length; i++) {
            require(newResults[i].delegate != address(0), "Delegate has to be set");      
            results[0].push(newResults[i]);

            for (uint r = 0; i < 6; i++) {
                if (newResults[i].ranks[r] != address(0)) {
                    uint8 reward = uint8(_rewards[r]);
                    this.mint(newResults[i].ranks[r], reward);
                }
            }
        }
    }
}