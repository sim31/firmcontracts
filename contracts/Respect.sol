// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";
import "./FirmAccountSystem.sol";
import "./Named.sol";
import "hardhat/console.sol";

contract Respect is FirmAccountSystem {
    event Transfer(address indexed from, address indexed to, uint256 value);

    using AccountSystemImpl for AccountSystemState;

    string public symbol;
    uint256 public totalSupply;

    mapping(AccountId => uint256) private _balances;

    constructor(
        Block memory genesisBl,
        ConfirmerOp[] memory confirmerOps,
        uint8 threshold,
        string memory name_,
        string memory symbol_
    )
        FirmAccountSystem(genesisBl, confirmerOps, threshold, name_) 
    {
        symbol = symbol_;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        AccountId accountId = byAddress(account);
        return balanceOfAccount(accountId);
    }

    function balanceOfAccount(AccountId accountId) public view virtual returns (uint256) {
        return _balances[accountId];
    }

    function _mint(AccountId accountId, uint256 amount) internal virtual {
        Account storage acc = _getAccount(accountId);
        require(accountNotNull(acc), "Account has to be non-null");

        totalSupply += amount;
        unchecked {
            // Overflow not possible: balance + amount is at most totalSupply + amount, which is checked above.
            _balances[accountId] += amount;
        }
        emit Transfer(address(0), acc.addr, amount);
    }

    function _burn(AccountId accountId, uint256 amount) internal virtual {
        Account storage acc = _getAccount(accountId);
        require(accountNotNull(acc), "Account has to be non-null");

        uint256 accountBalance = _balances[accountId];
        require(accountBalance >= amount, "Burn amount exceeds balance");
        unchecked {
            _balances[accountId] = accountBalance - amount;
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

    function removeAccount(AccountId accountId) external virtual override returns (Account memory) {
        uint256 balance = _balances[accountId];
        if (balance > 0) {
            _burn(accountId, balance);
        }

        // Fails if nothing is removed
        Account storage acc = _accounts.removeAccountFromSelf(accountId);

        return acc;
    }
}