// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "hardhat/console.sol";

struct Account {
    address addr;
    bytes32 metadataId;
}

struct AccountSystemState {
    // Can contain gaps 
    // AccountId (index) => address
    Account[] accounts;
    mapping(address => AccountId) byAddress;
}

type AccountId is uint64;
uint constant MAX_ACCOUNT_ID = type(uint64).max;
address constant RESERVED_ACCOUNT = address(1);
address constant NULL_ACCOUNT = address(0);
AccountId constant NULL_ACCOUNT_ID = AccountId.wrap(0);

library AccountSystemImpl {
    event AccountCreated(AccountId id);
    event AccountUpdated(AccountId id, Account updatedAcc);
    event AccountRemoved(AccountId id);

    function construct(AccountSystemState storage self) external {
        self.accounts.push(Account({ addr: NULL_ACCOUNT, metadataId: 0 }));
    } 

    function accountExists(
        AccountSystemState storage self,
        AccountId id
    ) public view returns (bool) {
        return accountNotNull(self.accounts[AccountId.unwrap(id)]);
    }

    function accountNotNull(Account storage account) public view returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }

    function accountNotNullMem(Account memory account) public pure returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }

    function accountNotNullCdata(Account calldata account) public pure returns (bool) {
        return account.addr != NULL_ACCOUNT;
    }
    
    // TODO: check if can be called from client of the library
    function accountHasAddr(Account storage account) public view returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function accountHasAddrMem(Account memory account) public pure returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function accountHasAddrCdata(Account memory account) public pure returns (bool) {
        return account.addr != RESERVED_ACCOUNT;
    }

    function createAccount(
        AccountSystemState storage self,
        Account memory account
    ) public validAccount(account) returns (AccountId) {
        require(self.accounts.length <= MAX_ACCOUNT_ID, "Too many accounts");

        if (accountNotNullMem(account)) {
            self.byAddress[account.addr] = AccountId.wrap(
                uint64(self.accounts.length)
            );
            self.accounts.push(account);
        } else {
            self.accounts.push(Account(RESERVED_ACCOUNT, account.metadataId));
        }

        AccountId id = AccountId.wrap(uint64(self.accounts.length - 1));
        emit AccountCreated(id);
        return id;
    }

    function createAccountFromSelf(
        AccountSystemState storage self,
        Account calldata account
    ) external fromSelf returns (AccountId) {
        return createAccount(self, account);
    }

    function removeAccount(
        AccountSystemState storage self,
        AccountId accountId
    ) public nonNullId(accountId) returns (Account storage) {
        Account storage account = self.accounts[AccountId.unwrap(accountId)];

        if (accountNotNull(account) && accountHasAddr(account)) {
            self.byAddress[account.addr] = NULL_ACCOUNT_ID;
        }

        // Sets addr of this entry to 0 (NULL_ACCOUNT)
        delete self.accounts[AccountId.unwrap(accountId)];

        emit AccountRemoved(accountId);
        
        return account;
    }

    function removeAccountFromSelf(
        AccountSystemState storage self,
        AccountId accountId
    ) external fromSelf returns (Account storage) {
        return removeAccount(self, accountId);
    }

    function updateAccount(
        AccountSystemState storage self,
        AccountId id,
        Account calldata newAccount
    ) public validAccount(newAccount) nonNullId(id) returns (Account storage) {
        Account storage oldAccount = self.accounts[AccountId.unwrap(id)];

        if (oldAccount.addr != newAccount.addr) {
            if (oldAccount.addr != NULL_ACCOUNT) {
                self.byAddress[oldAccount.addr] = NULL_ACCOUNT_ID;
            }
            if (newAccount.addr != NULL_ACCOUNT) {
                self.byAddress[newAccount.addr] = id;
            }
        }
        if (newAccount.addr == NULL_ACCOUNT) {
            Account memory acc = Account(RESERVED_ACCOUNT, newAccount.metadataId);
            self.accounts[AccountId.unwrap(id)] = acc;
            emit AccountUpdated(id, acc);

        } else {
            self.accounts[AccountId.unwrap(id)] = newAccount;
            emit AccountUpdated(id, newAccount);
        }
        
        return oldAccount;
    }

    function updateAccountFromSelf(
        AccountSystemState storage self,
        AccountId id,
        Account calldata newAccount
    ) external fromSelf returns (Account storage) {
        return updateAccount(self, id, newAccount);
    }

    modifier fromSelf() {
        require(msg.sender == address(this), "Can only be called by self");
        _;
    }

    modifier validAccount(Account memory account) {
        require(account.metadataId != 0 || account.addr != NULL_ACCOUNT,
            "Shouldn't set an empty account"
        );
        require(account.addr != RESERVED_ACCOUNT,
            "Cannot set reserved address for an account"
        );
        _;
    }

    modifier nonNullId(AccountId id) {
        require(AccountId.unwrap(id) != AccountId.unwrap(NULL_ACCOUNT_ID),
            "0 account id is reserved"
        );
        _;
    }
}