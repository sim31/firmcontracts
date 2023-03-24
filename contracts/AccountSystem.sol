// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";

struct Account {
    address addr;
    bytes32 metadataId;
}

type AccountId is uint64;
uint constant MAX_ACCOUNT_ID = type(uint64).max;
address constant RESERVED = address(1);

contract AccountSystem is SelfCalled {
    // Can contain gaps 
    // AccountId (index) => address
    Account[] public accounts;
    mapping(address => AccountId) public byAddress;

    constructor() {
        accounts.push(Account({ addr: address(0), metadataId: 0 }));
    }

    function accountExists(AccountId id) public view {


    }

    function _createAccount(Account calldata account) internal virtual {
        require(accounts.length < MAX_ACCOUNT_ID, "Too many accounts");
        require(account.metadataId != 0 || account.addr != address(0),
            "Shouldn't set an empty account"
        );
        _beforeCreation(account);
        if (account.addr != address(0)) {
            byAddress[account.addr] = AccountId.wrap(uint64(accounts.length));
        }
        accounts.push(account);
    }

    function createAccount(Account calldata account) external fromSelf {
        _createAccount(account);
    }

    function _removeAccount(AccountId accountId) internal virtual {
        require(AccountId.unwrap(accountId) != 0,  "0 account id is reserved");

        Account storage account = accounts[AccountId.unwrap(accountId)];

        _beforeRemoval(accountId, account);

        if (account.addr != address(0)) {
            byAddress[account.addr] = AccountId.wrap(0);
        }

        delete accounts[AccountId.unwrap(accountId)];
    }

    function removeAccount(AccountId accountId) external fromSelf {
        _removeAccount(accountId);
    }

    function _updateAccount(AccountId id, Account calldata newAccount) internal virtual {
        require(AccountId.unwrap(id) != 0, "0 account id is reserved");
        require(newAccount.metadataId != 0 || newAccount.addr != address(0),
            "Shouldn't set an empty account"
        );

        Account storage oldAccount = accounts[AccountId.unwrap(id)];

        _beforeUpdate(id, oldAccount, newAccount);

        if (oldAccount.addr != newAccount.addr) {
            if (oldAccount.addr != address(0)) {
                byAddress[oldAccount.addr] = AccountId.wrap(0);
            }
            if (newAccount.addr != address(0)) {
                byAddress[newAccount.addr] = id;
            }
        }
        accounts[AccountId.unwrap(id)] = newAccount;
    }

    function updateAccount(AccountId id, Account calldata newAccount) external fromSelf {
        _updateAccount(id, newAccount);
    }

    function _beforeRemoval(AccountId id, Account storage account) internal virtual {}
    function _beforeUpdate(
        AccountId id,
        Account storage oldAccount,
        Account calldata newAccount
    ) internal virtual {}
    function _beforeCreation(Account calldata account) internal virtual {}
}