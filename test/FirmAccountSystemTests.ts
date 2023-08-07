import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize, deployToken } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet, ContractTransaction } from "ethers";
import { AccountSystemImpl, FirmChainImpl, FirmAccountSystem } from "../typechain-types";
import { ConfirmerOpValue, ExtendedBlock, ZeroAddr, ZeroId } from "../interface/types";
import { createAddConfirmerOp, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";
import { randomBytes32Hex } from "../interface/abi";
import { deployEFFixt } from "./EdenPlusFractalTests";

chai.use(chaiSubset);

export type FirmAccountSystemInfo = Overwrite<ChainInfo, { chain: FirmAccountSystem }>;

export async function deployFirmAccountSystem(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  name: string,
  implLib: FirmChainImpl,
  accountSystemImpl: AccountSystemImpl,
): Promise<FirmAccountSystemInfo> {
  const factory = await ethers.getContractFactory(
    "FirmAccountSystem",
    {
      libraries: {
        FirmChainImpl: implLib.address,
        AccountSystemImpl: accountSystemImpl.address,
      }
    }
  );

  const confOps: ConfirmerOpValue[] = confirmers.map((conf) => {
    return createAddConfirmerOp(conf, 1);
  });
  const genesisBlock = await createGenesisBlock([], confOps, threshold);

  const deployCall = factory.deploy(genesisBlock, confOps, threshold, name);
  await expect(deployCall).to.not.be.reverted;
  const chain = await deployCall;
  const genesisBl: ExtendedBlock = {
    ...genesisBlock,
    contract: chain,
    signers: [],
    signatures: [],
  };

  return {
    confirmers,
    chain,
    nextHeader: (await createBlockTemplate(genesisBl)).header,
    genesisBl: genesisBl,
    confirmerValues: genesisBl.state.confirmerSet.confirmers,
    threshold: genesisBl.state.confirmerSet.threshold,
    headBlock: genesisBl,
    lastFinalized: genesisBl,
  };
}

export async function deployAccountSysImpl(): Promise<AccountSystemImpl> {
  const factory = await ethers.getContractFactory(
    "AccountSystemImpl",
  );
  let lib;
  expect(lib = await factory.deploy()).to.not.be.reverted;
  
  return lib;
}

export async function deployImplementations() {
  const fixtVars = await loadFixture(deployImplLib);
  const accSys = await deployAccountSysImpl();
  return { ...fixtVars, accSys };
}

async function deploy2ndOrderFirmAccs() {
  const { implLib, abiLib, signers, accSys } = await loadFixture(deployImplementations);
  const wallets = await abi.createWallets(16);

  const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
  const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
  const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

  const ord2Chain = await deployFirmAccountSystem([
    chain1,
    chain2,
    chain3,
  ], 2, "Test", implLib, accSys);

  return {
    chain1, chain2, chain3,
    ord2Chain,
    abiLib, signers,
    wallets,
  };
}

async function deployWithAccounts() {
  const fixtVars = await loadFixture(deploy2ndOrderFirmAccs);

  const accounts = [
    {
      addr: ZeroAddr,
      name: 'acc1',
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[1]!.address,
      name: 'acc2',
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[2]!.address,
      name: 'acc3',
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[3]!.address,
      name: 'acc4',
      metadataId: randomBytes32Hex(),
    }
  ];

  const msgs = accounts.map(account => {
    return createMsg(fixtVars.ord2Chain.chain, 'createAccount', [account])
  });

  // console.log("ord2Chain 1: ", fixtVars.ord2Chain.headBlock.header);
  // console.log("getHead 1: ", await fixtVars.ord2Chain.chain.getHead());

  const newOrd2Chain = await createBlockAndExecute(
    fixtVars.ord2Chain,
    msgs,
    fixtVars.ord2Chain.confirmers,
  );

  // console.log("ord2Chain: ", fixtVars.ord2Chain.headBlock.header);
  // console.log("newOrd2Chain: ", newOrd2Chain.headBlock.header);
  // console.log("getHead2: ", await fixtVars.ord2Chain.chain.getHead());

  type AccountWithId = typeof accounts[0] & { id: number };
  const accountsWithIds: AccountWithId[] = [];
  for (const [index, account] of accounts.entries()) {
    const id = await getCreatedAccId(newOrd2Chain.lastExecTx!, index);
    accountsWithIds.push({ ...account, id });
  }

  // Note that accountsWithIds has 0 for the accounts for which it doesn't set the address
  return { ...fixtVars, newOrd2Chain, accounts: accountsWithIds };
}

// index - which account id to return if multiple were created
export async function getCreatedAccId(tx: ContractTransaction, index: number = 0): Promise<number> {
  const { events } = await tx.wait();
  const event = events?.filter(x => x.event === "AccountCreated");
  expect(event).to.not.be.undefined;
  expect(event![index]).to.not.be.undefined;
  const id = event![index]!.args![0] as number;
  return id;
}

describe("FirmAccountSystem", function() {
  describe("Deployment", async function () {
    it("Should deploy successfully", async function() {
      await loadFixture(deploy2ndOrderFirmAccs);
    });
  });

  describe("Account creation", async function() {
    it("Should not allow external actors to create an account", async function() {
      const { ord2Chain, wallets } = await loadFixture(deploy2ndOrderFirmAccs);

      await expect(ord2Chain.chain.createAccount(
        { addr: wallets[0]!.address, name: 'accounta', metadataId: ZeroId }
      )).to.be.revertedWith("Can only be called by self");
    });

    it("Should create an account without an address when authorized by self", async function() {
      const { ord2Chain, wallets } = await loadFixture(deploy2ndOrderFirmAccs);

      const metadataId = randomBytes32Hex();
      const newOrd2Chain = await createBlockAndFinalize(
        ord2Chain,
        [
          createMsg(
            ord2Chain.chain,
            'createAccount',
            [{ addr: ZeroAddr, name: 'accounta', metadataId }]),
        ],
        ord2Chain.confirmers,
      );

      let t;
      await expect(t = newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized)).to.not.be.reverted;
      const tx = await t;
      const id = await getCreatedAccId(tx);

      expect(await ord2Chain.chain.getAccount(id)).to.containSubset({
        metadataId
      });

      expect(await ord2Chain.chain.accountExists(id)).to.be.true;

      const acc = await ord2Chain.chain.getAccount(id);

      expect(await ord2Chain.chain.accountNotNullCdata(acc)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(acc)).to.be.false;
    });

    it("Should create an account with an address when authorized by self", async function() {
      const { ord2Chain, wallets } = await loadFixture(deploy2ndOrderFirmAccs);

      const account = { addr: wallets[0]!.address, name: 'acca', metadataId: randomBytes32Hex() };
      const newOrd2Chain = await createBlockAndFinalize(
        ord2Chain,
        [
          createMsg(
            ord2Chain.chain,
            'createAccount',
            [account]
          ),
        ],
        ord2Chain.confirmers,
      );

      let t;
      await expect(t = await newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized)).to.not.be.reverted;
      const tx = await t;
      const id = await getCreatedAccId(tx);

      expect(await ord2Chain.chain.getAccount(id)).to.containSubset(account);

      expect(await ord2Chain.chain.accountExists(id)).to.be.true;

      const acc = await ord2Chain.chain.getAccount(id);

      expect(await ord2Chain.chain.accountNotNullCdata(acc)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(acc)).to.be.true;
      
      expect(await ord2Chain.chain.byAddress(wallets[0]!.address)).to.be.equal(id);
    });
  });

  describe("Removing an account", async function() {
    it("Should not allow removal by external actors", async function() {
      const { ord2Chain, accounts } = await loadFixture(deployWithAccounts);
      
      await expect(ord2Chain.chain.removeAccount(accounts[0]!.id))
        .to.be.revertedWith("Can only be called by self");
    });

    it("Should not allow removing reserved account", async function() {
      const { ord2Chain, accounts, newOrd2Chain } = await loadFixture(deployWithAccounts);

      // console.log("newOrd2Chain 2: ", newOrd2Chain.headBlock.header);
      // console.log("getHead: ", await newOrd2Chain.chain.getHead());

      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'removeAccount', [0])],
        newOrd2Chain.confirmers,
      );
      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCallFail");
    });

    it("Should remove account without an address", async function() {
      const { ord2Chain, accounts, newOrd2Chain } = await loadFixture(deployWithAccounts);

      expect(await ord2Chain.chain.accountExists(accounts[0]!.id)).to.be.true;
      let account = await ord2Chain.chain.getAccount(accounts[0]!.id);
      expect(await ord2Chain.chain.accountHasAddrCdata(account)).to.be.false;

      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'removeAccount', [accounts[0]!.id])],
        newOrd2Chain.confirmers,
      );
      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCall");

      expect(await ord2Chain.chain.accountExists(accounts[0]!.id)).to.be.false;
      account = await ord2Chain.chain.getAccount(accounts[0]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(account)).to.be.false;
    });

    it("Should remove an account with an address", async function() {
      const { ord2Chain, accounts, newOrd2Chain } = await loadFixture(deployWithAccounts);

      expect(await ord2Chain.chain.accountExists(accounts[1]!.id)).to.be.true;
      let account = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(await ord2Chain.chain.accountHasAddrCdata(account)).to.be.true;
      const addr = account.addr;
      expect(await ord2Chain.chain.byAddress(addr)).to.be.equal(accounts[1]!.id);

      const newOrd2Chain2 = await createBlockAndExecute(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'removeAccount', [accounts[1]!.id])],
        newOrd2Chain.confirmers,
      );

      expect(await ord2Chain.chain.accountExists(accounts[1]!.id)).to.be.false;
      account = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(account)).to.be.false;
      expect(await ord2Chain.chain.byAddress(addr)).to.equal(0);
    })
  });

  describe("Updating an account", async function() {
    it("Should not allow updating account id 0", async function() {
      const { ord2Chain, accounts, newOrd2Chain } = await loadFixture(deployWithAccounts);

      const account = { addr: ZeroAddr, name: 'acca', metadataId: randomBytes32Hex() };
      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'updateAccount', [0, account])],
        newOrd2Chain.confirmers,
      );

      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCallFail");
    });

    it("Should not allow external actors to update an account", async function() {
      const { ord2Chain, accounts, newOrd2Chain } = await loadFixture(deployWithAccounts);

      const account = { addr: ZeroAddr, name: 'accb', metadataId: randomBytes32Hex() };

      await expect(ord2Chain.chain.updateAccount(accounts[0]!.id, account))
        .to.be.revertedWith("Can only be called by self");
    });

    it("Should allow setting an address on a account without an address yet", async function() {
      const { ord2Chain, accounts, newOrd2Chain, wallets } = await loadFixture(deployWithAccounts);

      const oldAccount = await ord2Chain.chain.getAccount(accounts[0]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(oldAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(oldAccount)).to.be.false;
      expect(await ord2Chain.chain.byAddress(accounts[0]!.addr)).to.be.equal(0);

      const account = { ...oldAccount, addr: wallets[8]!.address, };
      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'updateAccount', [accounts[0]!.id, account])],
        newOrd2Chain.confirmers,
      );

      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCall");
      
      const newAccount = await ord2Chain.chain.getAccount(accounts[0]!.id);
      expect(newAccount.metadataId).to.be.equal(oldAccount.metadataId);
      expect(newAccount.addr).to.be.equal(wallets[8]!.address);
      expect(await ord2Chain.chain.accountNotNullCdata(newAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(newAccount)).to.be.true;
      expect(await ord2Chain.chain.byAddress(wallets[8]!.address)).to.be.equal(accounts[0]!.id);
    });

    it("Should allow nulling an address for an account with an address", async function() {
      const { ord2Chain, accounts, newOrd2Chain, wallets } = await loadFixture(deployWithAccounts);

      const oldAccount = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(oldAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(oldAccount)).to.be.true;
      expect(await ord2Chain.chain.byAddress(accounts[1]!.addr)).to.be.equal(accounts[1]!.id);

      const account = { ...oldAccount, addr: ZeroAddr, };
      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'updateAccount', [accounts[1]!.id, account])],
        newOrd2Chain.confirmers,
      );

      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCall");
      
      const newAccount = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(newAccount.metadataId).to.be.equal(oldAccount.metadataId);
      expect(await ord2Chain.chain.accountNotNullCdata(newAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(newAccount)).to.be.false;
      expect(await ord2Chain.chain.byAddress(oldAccount.addr)).to.be.equal(0);
    });

    it("Should allow switching an address for an account", async function() {
      const { ord2Chain, accounts, newOrd2Chain, wallets } = await loadFixture(deployWithAccounts);

      const oldAccount = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(oldAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(oldAccount)).to.be.true;
      expect(await ord2Chain.chain.byAddress(accounts[1]!.addr)).to.be.equal(accounts[1]!.id);
      expect(oldAccount.addr).to.not.equal(wallets[9]!.address);

      const account = { ...oldAccount, addr: wallets[9]!.address, };
      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'updateAccount', [accounts[1]!.id, account])],
        newOrd2Chain.confirmers,
      );

      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCall");
      
      const newAccount = await ord2Chain.chain.getAccount(accounts[1]!.id);
      expect(newAccount.metadataId).to.be.equal(oldAccount.metadataId);
      expect(newAccount.addr).to.be.equal(wallets[9]!.address);
      expect(await ord2Chain.chain.accountNotNullCdata(newAccount)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(newAccount)).to.be.true;
      expect(await ord2Chain.chain.byAddress(wallets[9]!.address)).to.be.equal(accounts[1]!.id);
    });

    it("Should allow changing metadataId of an account", async function() {
      const { ord2Chain, accounts, newOrd2Chain, wallets } = await loadFixture(deployWithAccounts);

      const newMetadataId = randomBytes32Hex();

      const oldAccount = await ord2Chain.chain.getAccount(accounts[2]!.id);
      expect(await ord2Chain.chain.accountNotNullCdata(oldAccount)).to.be.true;
      expect(oldAccount.metadataId).to.not.equal(newMetadataId);

      const account = { ...oldAccount, metadataId: newMetadataId };
      const newOrd2Chain2 = await createBlockAndFinalize(
        newOrd2Chain,
        [createMsg(ord2Chain.chain, 'updateAccount', [accounts[2]!.id, account])],
        newOrd2Chain.confirmers,
      );

      await expect(ord2Chain.chain.execute(newOrd2Chain2.lastFinalized))
        .to.emit(ord2Chain.chain, "ExternalCall");
      
      const newAccount = await ord2Chain.chain.getAccount(accounts[2]!.id);
      expect(newAccount.metadataId).to.be.equal(newMetadataId);
      expect(newAccount.addr).to.be.equal(oldAccount.addr);
      expect(await ord2Chain.chain.accountNotNullCdata(newAccount)).to.be.true;
    });
  });
});