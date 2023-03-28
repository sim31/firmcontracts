// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./SelfCalled.sol";

struct Account {
    address addr;
    bytes32 metadataId;
}

type AccountId is uint64;
uint constant MAX_ACCOUNT_ID = type(uint64).max;
address constant RESERVED_ACCOUNT = address(1);
address constant NULL_ACCOUNT = address(0);
AccountId constant NULL_ACCOUNT_ID = AccountId.wrap(0);

abstract contract AccountSystem is SelfCalled {
    event AccountCreated(AccountId id);
    event AccountUpdated(AccountId id, Account updatedAcc);
    event AccountRemoved(AccountId id);

    // Can contain gaps 
    // AccountId (index) => address
    Account[] public accounts;
    mapping(address => AccountId) public byAddress;

    constructor() {
        accounts.push(Account({ addr: NULL_ACCOUNT, metadataId: 0 }));
    }

    function accountExists(AccountId id) public view returns (bool) {
        return accountNotNull(accounts[AccountId.unwrap(id)]);
    }

    function accountNotNull(Account storage account) internal view returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }

    function accountNotNullMem(Account memory account) public pure returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }

    function accountNotNullCdata(Account calldata account) public pure returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }
    
    function accountHasAddr(Account storage account) internal view returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function accountHasAddrMem(Account memory account) public pure returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function accountHasAddrCdata(Account memory account) public pure returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function _createAccount(Account calldata account) internal virtual returns (AccountId) {
        require(accounts.length <= MAX_ACCOUNT_ID, "Too many accounts");
        require(account.metadataId != 0 || account.addr != NULL_ACCOUNT,
            "Shouldn't set an empty account"
        );
        _beforeCreation(account);
        if (accountNotNullCdata(account)) {
            byAddress[account.addr] = AccountId.wrap(uint64(accounts.length));
            accounts.push(account);
        } else {
            accounts.push(Account(RESERVED_ACCOUNT, account.metadataId));
        }

        AccountId id = AccountId.wrap(uint64(accounts.length - 1));
        emit AccountCreated(id);
        return id;
    }

    function createAccount(Account calldata account) external fromSelf returns (AccountId) {
        return _createAccount(account);
    }

    function _removeAccount(AccountId accountId) internal virtual {
        require(AccountId.unwrap(accountId) != 0,  "0 account id is reserved");

        Account storage account = accounts[AccountId.unwrap(accountId)];

        _beforeRemoval(accountId, account);

        if (accountNotNull(account) && accountHasAddr(account)) {
            byAddress[account.addr] = NULL_ACCOUNT_ID;
        }

        // Sets addr of this entry to 0 (NULL_ACCOUNT)
        delete accounts[AccountId.unwrap(accountId)];

        emit AccountRemoved(accountId);
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
            if (oldAccount.addr != NULL_ACCOUNT) {
                byAddress[oldAccount.addr] = NULL_ACCOUNT_ID;
            }
            if (newAccount.addr != NULL_ACCOUNT) {
                byAddress[newAccount.addr] = id;
            }
        }
        if (newAccount.addr == NULL_ACCOUNT) {
            Account memory acc = Account(RESERVED_ACCOUNT, newAccount.metadataId);
            accounts[AccountId.unwrap(id)] = acc;
            emit AccountUpdated(id, acc);

        } else {
            accounts[AccountId.unwrap(id)] = newAccount;
            emit AccountUpdated(id, newAccount);
        }
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