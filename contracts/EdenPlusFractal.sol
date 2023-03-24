// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./FirmChain.sol";

contract EdenPlusFractal is FirmChain {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    struct Account {
        address addr;
        uint256 balance;
    }
    struct BreakoutResults {
        AccountId delegate;
        // From lowest (least contributed) to highest
        AccountId[6] ranks;
    }

    type AccountId is uint64;
    uint constant MAX_ACCOUNT_ID = type(uint64).max;
    address constant RESERVED = address(1);

    // Can contain gaps 
    // AccountId (index) => address
    Account[] public accounts;
    mapping(address => AccountId) public accountByAddr;

    // Delegates from the last 4 weeks
    AccountId[][4] public delegates;

    bytes32 public directoryId;

    string public name;
    string public symbol;
    uint256 public totalSupply;

    bytes constant _rewards = hex"020305080D15";

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        string memory name_,
        string memory symbol_
    ) FirmChain(genesisBl, confirmerOps, threshold) {
        name = name_;
        symbol = symbol_;
        // 0 id is reserved (needed for accountByAddr mapping)
        accounts.push(Account({ addr: address(0), balance: 0 }));
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        AccountId accountId = accountByAddr[account];
        return balanceOfAccount(accountId);
    }

    function balanceOfAccount(AccountId accountId) public view virtual returns (uint256) {
        return accounts[AccountId.unwrap(accountId)].balance;
    }

    function _mint(AccountId accountId, uint256 amount) internal virtual {
        Account storage acc = accounts[AccountId.unwrap(accountId)];
        require(acc.addr != address(0), "Account has to be created");

        totalSupply += amount;
        unchecked {
            // Overflow not possible: balance + amount is at most totalSupply + amount, which is checked above.
            acc.balance += amount;
        }
        emit Transfer(address(0), acc.addr, amount);
    }

    function _burn(AccountId accountId, uint256 amount) internal virtual {
        Account storage acc = accounts[AccountId.unwrap(accountId)];
        require(acc.addr != address(0), "Account has to be created");

        require(acc.balance >= amount, "Burn amount exceeds balance");
        unchecked {
            acc.balance = acc.balance - amount;
            // Overflow not possible: amount <= accountBalance <= totalSupply.
            totalSupply -= amount;
        }

        emit Transfer(acc.addr, address(0), amount);
    }

    function mint(AccountId accountId, uint256 amount) external fromSelf {
        _mint(accountId, amount);
    }

    function burn(AccountId accountId, uint256 amount) external fromSelf {
        _burn(accountId, amount);
    }


    function _setDirectory(bytes32 directoryId_) internal virtual {
        directoryId = directoryId_;
    }

    function setDirectory(bytes32 directoryId_) external fromSelf {
        _setDirectory(directoryId_);
    }

    function submitResults(BreakoutResults[] calldata newResults) external fromSelf {
        delegates[3] = delegates[2];
        delegates[2] = delegates[1];
        delegates[1] = delegates[0];
        delete delegates[0];

        for (uint i = 0; i < newResults.length; i++) {
            Account storage delegateAcc = accounts[AccountId.unwrap(newResults[i].delegate)];
            require(delegateAcc.addr != address(0), "Delegate has to be set");
            delegates[0].push(newResults[i].delegate);

            for (uint r = 0; i < 6; i++) {
                uint64 rankedId = AccountId.unwrap(newResults[i].ranks[r]);
                if (accounts[rankedId].addr != address(0)) {
                    require(accounts[rankedId].addr != address(0), "Account is deleted");
                    uint8 reward = uint8(_rewards[r]);
                    _mint(AccountId.wrap(rankedId), reward);
                }
            }
        }
    }
}