// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.8;

import "./AccountSystemImpl.sol";

abstract contract AccountSystem {
    event AccountCreated(AccountId id);
    event AccountUpdated(AccountId id, Account updatedAcc);
    event AccountRemoved(AccountId id);

    using AccountSystemImpl for AccountSystemState;

    AccountSystemState internal _accounts;

    constructor() {
        _accounts.construct();
    }

    function accounts() public view virtual returns (Account[] memory) {
        return _accounts.accounts;
    }

    function getAccount(AccountId id) public view virtual returns (Account memory) {
        return _accounts.accounts[AccountId.unwrap(id)];
    }

    function _getAccount(AccountId id) internal view returns (Account storage) {
        return _accounts.accounts[AccountId.unwrap(id)];
    }

    function byAddress(address addr) public view virtual returns (AccountId) {
        return _accounts.byAddress[addr];
    }

    function accountExists(AccountId id) public view virtual returns (bool) {
        return _accounts.accountExists(id);
    }

    function accountNotNull(Account storage account) internal view returns (bool) {
        return AccountSystemImpl.accountNotNull(account);
    }

    function accountNotNullMem(Account memory account) public pure virtual returns (bool) {
        return AccountSystemImpl.accountNotNullMem(account);
    }

    function accountNotNullCdata(Account calldata account) public pure virtual returns (bool) {
        return AccountSystemImpl.accountNotNullCdata(account);
    }
    
    function accountHasAddr(Account storage account) internal view returns (bool) {
        return AccountSystemImpl.accountHasAddr(account);
    }

    function accountHasAddrMem(Account memory account) public pure virtual returns (bool) {
        return AccountSystemImpl.accountHasAddrMem(account);
    }

    function accountHasAddrCdata(Account memory account) public pure virtual returns (bool) {
        return AccountSystemImpl.accountHasAddrCdata(account);
    }

    function createAccount(Account calldata account) external virtual returns (AccountId) {
        return _accounts.createAccountFromSelf(account);
    }

    function removeAccount(AccountId accountId) external virtual returns (Account memory) {
        return _accounts.removeAccountFromSelf(accountId);
    }

    function updateAccount(AccountId id, Account calldata newAccount) external virtual returns (Account memory) {
        return _accounts.updateAccountFromSelf(id, newAccount);
    }
}