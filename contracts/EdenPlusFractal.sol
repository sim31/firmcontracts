// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./Respect.sol";
import "./Directory.sol";

contract EdenPlusFractal is Respect, Directory {
    struct BreakoutResults {
        AccountId delegate;
        // From lowest (least contributed) to highest
        AccountId[6] ranks;
    }

    // Delegates from the last 4 weeks
    AccountId[][4] public delegates;

    bytes constant _rewards = hex"020305080D15";

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        string memory name_,
        string memory symbol_
    ) Respect(genesisBl, confirmerOps, threshold, name_, symbol_) {}

    function submitResults(BreakoutResults[] calldata newResults) external fromSelf {
        delegates[3] = delegates[2];
        delegates[2] = delegates[1];
        delegates[1] = delegates[0];
        delete delegates[0];

        for (uint i = 0; i < newResults.length; i++) {
            Account storage delegateAcc = accounts[AccountId.unwrap(newResults[i].delegate)];
            require(accountNotNull(delegateAcc), "Delegate has to be set");
            delegates[0].push(newResults[i].delegate);

            for (uint r = 0; i < 6; i++) {
                uint64 rankedId = AccountId.unwrap(newResults[i].ranks[r]);
                Account storage rankedAcc = accounts[rankedId];
                if (accountNotNull(rankedAcc)) {
                    uint8 reward = uint8(_rewards[r]);
                    _mint(AccountId.wrap(rankedId), reward);
                }
            }
        }
    }
}