// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./FirmChain.sol";
import "./IssuedToken.sol";

contract EdenPlusFractal is FirmChain {
    struct BreakoutResults {
        address delegate;
        // From lowest (least contributed) to highest
        address[6] ranks;
    }

    bytes constant _rewards = hex"020305080D15";
    IssuedToken immutable _token;

    // Results of the last 4 weeks
    BreakoutResults[][4] public results;

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        IssuedToken tokenAddr
    ) FirmChain(genesisBl, confirmerOps, threshold)  {
        _token = tokenAddr;
    }

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
                    _token.mint(newResults[i].ranks[r], reward);
                }
            }            
        }
    }
}