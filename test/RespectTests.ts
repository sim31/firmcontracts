import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize, deployToken } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet, ContractTransaction } from "ethers";
import { Respect, FirmChainImpl, FirmAccountSystem, AccountSystemImpl } from "../typechain-types";
import { ConfirmerOpValue, ExtendedBlock, ZeroAddr, ZeroId } from "../interface/types";
import { createAddConfirmerOp, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";
import { randomBytes32Hex } from "../interface/abi";
import { getCreatedAccId, deployAccountSysImpl } from "./FirmAccountSystemTests";

chai.use(chaiSubset);

export type RespectInfo = Overwrite<ChainInfo, { chain: Respect }>;

export async function deployRespect(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  implLib: FirmChainImpl,
  accSysImpl: AccountSystemImpl,
  name: string,
  symbol: string,
): Promise<RespectInfo> {
  const factory = await ethers.getContractFactory(
    "Respect",
    {
      libraries: {
        FirmChainImpl: implLib.address,
        AccountSystemImpl: accSysImpl.address,
      }
    }
  );

  const confOps: ConfirmerOpValue[] = confirmers.map((conf) => {
    return createAddConfirmerOp(conf, 1);
  });
  const genesisBlock = await createGenesisBlock([], confOps, threshold);

  const deployCall = factory.deploy(genesisBlock, confOps, threshold, name, symbol);
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

export async function deployRespectFixt() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const accSys = await deployAccountSysImpl();
  const wallets = await abi.createWallets(8);

  const respectChain = await deployRespect([
    wallets[0]!,
    wallets[1]!,
    wallets[2]!,
    wallets[3]!,
  ], 3, implLib, accSys, "SomeFractal", "SF");

  // Create some accounts
  const accounts = [
    {
      addr: ZeroAddr,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[1]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[2]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[3]!.address,
      metadataId: randomBytes32Hex(),
    }
  ];

  const msgs = accounts.map(account => {
    return createMsg(respectChain.chain, 'createAccount', [account])
  });

  const newChain = await createBlockAndExecute(
    respectChain,
    msgs,
    respectChain.confirmers,
  );

  type AccountWithId = typeof accounts[0] & { id: number };
  const accountsWithIds: AccountWithId[] = [];
  for (const [index, account] of accounts.entries()) {
    const id = await getCreatedAccId(newChain.lastExecTx!, index);
    accountsWithIds.push({ ...account, id });
  }

  return {
    ...respectChain,
    latestChain: newChain,
    abiLib, signers, implLib, accSys,
    wallets,
    accounts: accountsWithIds,
  };
}

async function deployWithIssuedRespect() {
  const chainInfo = await loadFixture(deployRespectFixt);

  let amount = 0;
  const msgs = chainInfo.accounts.map(acc => {
    amount += 1;
    return createMsg(chainInfo.chain, 'mint', [acc.id, amount]);
  });

  const newChain = await createBlockAndExecute(
    chainInfo.latestChain, msgs, chainInfo.confirmers
  );

  return { ...chainInfo, latestChain: newChain };
}

describe("Respect", function() {
  describe("Deployment", async function() {
    it("Should deploy successfully", async function() {
      const { chain } = await loadFixture(deployRespectFixt);

      expect(await chain.name()).to.equal("SomeFractal");
      expect(await chain.symbol()).to.equal("SF");
    });
  });

  describe("Minting", async function() {
    it("Should not allow external actors to mint", async function() {
      const { chain, accounts } = await loadFixture(deployRespectFixt);

      expect(await chain.balanceOfAccount(accounts[0]!.id)).to.be.equal(0);

      await expect(chain.mint(accounts[0]!.id, 10)).to.be.revertedWith("Can only be called by self");
    });

    it("Should allow contract itself to mint", async function() {
      const { chain, accounts, latestChain, confirmers} = await loadFixture(deployRespectFixt);

      expect(await chain.balanceOfAccount(accounts[0]!.id)).to.be.equal(0);
      expect(await chain.totalSupply()).to.be.equal(0);

      const newChain = await createBlockAndFinalize(
        latestChain,
        [createMsg(chain, 'mint', [accounts[0]!.id, 10])],
        confirmers,
      );      

      await expect(chain.execute(newChain.lastFinalized))
        .to.emit(chain, "ExternalCall");
      
      expect(await chain.balanceOfAccount(accounts[0]!.id)).to.be.equal(10);
      expect(await chain.totalSupply()).to.be.equal(10);
    });

    it("Should not allow minting to non existent account id", async () => {
      const { chain, accounts, latestChain, confirmers} = await loadFixture(deployRespectFixt);

      const newChain = await createBlockAndFinalize(
        latestChain,
        [createMsg(chain, 'mint', [50, 10])],
        confirmers,
      );      

      await expect(chain.execute(newChain.lastFinalized))
        .to.emit(chain, "ExternalCallFail");
    });

    it(
      "Should increase balance returned by balanceOf (for accounts with addresses)",
      async function() {
        const { chain, accounts, latestChain, confirmers} = await loadFixture(deployRespectFixt);

        expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(0);
        expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(0);
        expect(await chain.totalSupply()).to.be.equal(0);

        const newChain = await createBlockAndFinalize(
          latestChain,
          [createMsg(chain, 'mint', [accounts[1]!.id, 5])],
          confirmers,
        );      

        await expect(chain.execute(newChain.lastFinalized))
          .to.emit(chain, "ExternalCall");
        
        expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(5);
        expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(5);
        expect(await chain.totalSupply()).to.be.equal(5);
      }
    );
  })

  describe("Burning", async function() {
    it("Should not allow burning by external actors", async function() {
      const { chain, accounts } = await loadFixture(deployWithIssuedRespect);

      expect(await chain.balanceOfAccount(accounts[0]!.id)).to.be.equal(1);

      await expect(chain.burn(accounts[0]!.id, 1))
        .to.be.revertedWith("Can only be called by self");
    });

    it("Should allow burning by contract itself", async function() {
      const { chain, accounts, confirmers, latestChain } = await loadFixture(deployWithIssuedRespect);

      const totalSupply = await chain.totalSupply();
      expect(await chain.balanceOfAccount(accounts[2]!.id)).to.be.equal(3);
      expect(await chain.balanceOf(accounts[2]!.addr)).to.be.equal(3);

      const newChain = await createBlockAndFinalize(
        latestChain,
        [createMsg(chain, 'burn', [accounts[2]!.id, 2])],
        confirmers,
      );
      await expect(chain.execute(newChain.lastFinalized))
        .to.emit(chain, "ExternalCall");

      expect(await chain.balanceOfAccount(accounts[2]!.id)).to.be.equal(1);
      expect(await chain.balanceOf(accounts[2]!.addr)).to.be.equal(1);
      expect(await chain.totalSupply()).to.be.equal(totalSupply.toNumber() - 2);
    });

    it("Should not allow burning more than available", async function() {
      const { chain, accounts, confirmers, latestChain } = await loadFixture(deployWithIssuedRespect);

      const totalSupply = await chain.totalSupply();
      expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(2);
      expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(2);

      const newChain = await createBlockAndFinalize(
        latestChain,
        [createMsg(chain, 'burn', [accounts[1]!.id, 3])],
        confirmers,
      );
      await expect(chain.execute(newChain.lastFinalized))
        .to.emit(chain, "ExternalCallFail");

      expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(2);
      expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(2);
      expect(await chain.totalSupply()).to.be.equal(totalSupply.toNumber());
    });

    it("Should not allow burning from non-existent account", async function() {
      const { chain, accounts, confirmers, latestChain } = await loadFixture(deployWithIssuedRespect);

      const newChain = await createBlockAndFinalize(
        latestChain,
        [createMsg(chain, 'burn', [30, 3])],
        confirmers,
      );
      await expect(chain.execute(newChain.lastFinalized))
        .to.emit(chain, "ExternalCallFail");
    });
  });

  describe("Account deletion", async function() {
    it("Should burn balance of deleted account", async function() {
      const { chain, accounts, confirmers, latestChain } = await loadFixture(deployWithIssuedRespect);

      const totalSupply = await chain.totalSupply();
      expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(2);
      expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(2);

      const newChain = await createBlockAndExecute(
        latestChain,
        [createMsg(chain, 'removeAccount', [accounts[1]!.id])],
        confirmers,
      );

      expect(await chain.totalSupply()).to.be.equal(totalSupply.toNumber() - 2);
      expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(0);
      expect(await chain.balanceOf(accounts[1]!.addr)).to.be.equal(0);
    });
  });
});