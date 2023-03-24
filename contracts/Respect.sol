// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";
import "./AccountSystem.sol";

contract Respect is SelfCalled, AccountSystem {
    string public name;
    string public symbol;
    uint256 public totalSupply;

    mapping(AccountId => uint256) private _balances;

    constructor(
        string memory name_,
        string memory symbol_
    ) {
        name = name_;
        symbol = symbol_;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        AccountId accountId = byAddress[account];
        return balanceOfAccount(accountId);
    }

    function balanceOfAccount(AccountId accountId) public view virtual returns (uint256) {
        return _balances[accountId];
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

}