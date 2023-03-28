import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize, deployToken } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet, ContractTransaction } from "ethers";
import { FirmDirectory, FirmChainImpl, FirmAccountSystem } from "../typechain-types";
import { ConfirmerOpValue, ExtendedBlock, ZeroAddr, ZeroId } from "../interface/types";
import { createAddConfirmerOp, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";
import { randomBytes32Hex } from "../interface/abi";

chai.use(chaiSubset);

export type FirmAccountSystemInfo = Overwrite<ChainInfo, { chain: FirmAccountSystem }>;

export async function deployFirmAccountSystem(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  implLib: FirmChainImpl,
): Promise<FirmAccountSystemInfo> {
  const factory = await ethers.getContractFactory(
    "FirmAccountSystem",
    {
      libraries: { FirmChainImpl: implLib.address }
    }
  );

  const confOps: ConfirmerOpValue[] = confirmers.map((conf) => {
    return createAddConfirmerOp(conf, 1);
  });
  const genesisBlock = await createGenesisBlock([], confOps, threshold);

  const deployCall = factory.deploy(genesisBlock, confOps, threshold);
  await expect(deployCall).to.not.be.reverted;
  const chain = await deployCall;
  const genesisBl: ExtendedBlock = {
    ...genesisBlock,
    contract: chain,
    signers: [],
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

async function deploy2ndOrderFirmAccs() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const wallets = await abi.createWallets(16);

  const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
  const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
  const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

  const ord2Chain = await deployFirmAccountSystem([
    chain1,
    chain2,
    chain3,
  ], 2, implLib);

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
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[1].address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[2].address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: fixtVars.wallets[3].address,
      metadataId: randomBytes32Hex(),
    }
  ];

  const msgs = accounts.map(account => {
    return createMsg(fixtVars.ord2Chain.chain, 'createAccount', [account])
  });

  const newOrd2Chain = await createBlockAndExecute(
    fixtVars.ord2Chain,
    msgs,
    fixtVars.ord2Chain.confirmers,
  );

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
  const id = event![index].args![0] as number;
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
        { addr: wallets[0].address, metadataId: ZeroId }
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
            [{ addr: ZeroAddr, metadataId }]),
        ],
        ord2Chain.confirmers,
      );

      let t;
      await expect(t = newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized)).to.not.be.reverted;
      const tx = await t;
      const id = await getCreatedAccId(tx);

      expect(await ord2Chain.chain.accounts(id)).to.containSubset({
        metadataId
      });

      expect(await ord2Chain.chain.accountExists(id)).to.be.true;

      const acc = await ord2Chain.chain.accounts(id);

      expect(await ord2Chain.chain.accountNotNullCdata(acc)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(acc)).to.be.false;
    });

    it("Should create an account with an address when authorized by self", async function() {
      const { ord2Chain, wallets } = await loadFixture(deploy2ndOrderFirmAccs);

      const account = { addr: wallets[0].address, metadataId: randomBytes32Hex() };
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

      expect(await ord2Chain.chain.accounts(id)).to.containSubset(account);

      expect(await ord2Chain.chain.accountExists(id)).to.be.true;

      const acc = await ord2Chain.chain.accounts(id);

      expect(await ord2Chain.chain.accountNotNullCdata(acc)).to.be.true;
      expect(await ord2Chain.chain.accountHasAddrCdata(acc)).to.be.true;
      
      expect(await ord2Chain.chain.byAddress(wallets[0].address)).to.be.equal(id);
    });
  });

  describe("Removing an account", async function() {
    it("Should not allow removal by external actors", async function() {
      const { ord2Chain, accounts } = await loadFixture(deployWithAccounts);
      
      await expect(ord2Chain.chain.removeAccount(accounts[0].id))
        .to.be.revertedWith("Can only be called by self");
    });

    // it("Should not allow ")
  });
});