// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./Respect.sol";
import "./Directory.sol";
import "hardhat/console.sol";

contract EdenPlusFractal is Respect, Directory {
    using AccountSystemImpl for AccountSystemState;

    struct BreakoutResults {
        AccountId delegate;
        // From lowest (least contributed) to highest
        AccountId[6] ranks;
    }

    // Delegates from the last 4 weeks
    AccountId[][4] private _delegates;

    bytes constant _rewards = hex"020305080D15";

    constructor(
        Block memory genesisBl,
        Account[] memory confirmers,
        uint8 threshold,
        string memory name_,
        string memory symbol_,
        bytes32 abiCID
    ) Respect(genesisBl, accountsToConfirmerOps(confirmers), threshold, name_, symbol_) Directory(abiCID) {
        for (uint i = 0; i < confirmers.length; i++) {
            _accounts.createAccount(confirmers[i]);
        }
    }

    function accountsToConfirmerOps(Account[] memory accounts)
        public pure returns(ConfirmerOp[] memory) {
        ConfirmerOp[] memory ops = new ConfirmerOp[](accounts.length);
        for (uint i = 0; i < accounts.length; i++) {
            Account memory acc = accounts[i];
            require(accountNotNullMem(acc), "Account has to have an address");
            ops[i] = ConfirmerOp({ 
                opId: ConfirmerOpId.ADD, 
                conf: Confirmer({ 
                    addr: acc.addr, weight: 1 
                })
            });
        }
        return ops;
    }

    // Will fail if a delegate is not set
    function getDelegate(uint8 weekIndex, uint8 roomIndex) public view virtual returns (AccountId) {
        return _delegates[weekIndex][roomIndex];
    }

    function getDelegates(uint8 weekIndex) public view virtual returns (AccountId[] memory) {
        return _delegates[weekIndex];
    }

    function submitResults(BreakoutResults[] calldata newResults) external fromSelf {
        _delegates[3] = _delegates[2];
        _delegates[2] = _delegates[1];
        _delegates[1] = _delegates[0];
        delete _delegates[0];

        for (uint i = 0; i < newResults.length; i++) {
            Account storage delegateAcc = _getAccount(newResults[i].delegate);
            require(accountNotNull(delegateAcc), "Delegate has to be set");
            _delegates[0].push(newResults[i].delegate);

            for (uint r = 0; r < 6; r++) {
                AccountId rankedId = newResults[i].ranks[r];
                Account storage rankedAcc = _getAccount(rankedId);
                if (accountNotNull(rankedAcc)) {
                    uint8 reward = uint8(_rewards[r]);
                    _mint(rankedId, reward);
                }
            }
        }
    }
}