import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize, deployToken } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet, ContractTransaction } from "ethers";
import { Respect, EdenPlusFractal, FirmChainImpl, AccountSystemImpl, Filesystem } from "../typechain-types";
import { Account, ConfirmerOpValue, ExtendedBlock, ZeroAddr, ZeroId } from "../interface/types";
import { createAddConfirmerOp, createBlock, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";
import { randomBytes32Hex } from "../interface/abi";
import { deployAccountSysImpl, getCreatedAccId } from "./FirmAccountSystemTests";
import { FirmContractDeployer } from "../interface/deployer";

const deployer = new FirmContractDeployer(ethers.provider);

chai.use(chaiSubset);

export type EFInfo = Overwrite<ChainInfo, { chain: EdenPlusFractal }>;

export async function deployEF(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  implLib: FirmChainImpl,
  accSysImpl: AccountSystemImpl,
  fsContract: Filesystem,
  name: string,
  symbol: string,
): Promise<EFInfo> {
  const factory = await ethers.getContractFactory(
    "EdenPlusFractal",
    {
      libraries: {
        FirmChainImpl: implLib.address,
        AccountSystemImpl: accSysImpl.address,
      }
    }
  );

  const confAccounts = confirmers.map((conf) => {
    if ('address' in conf) {
      return { addr: conf.address, metadataId: ZeroId };
    } else {
      return { addr: conf.chain.address, metadataId: ZeroId };
    }
  });
  const confOps = confAccounts.map((account) => {
    return createAddConfirmerOp(account.addr, 1);
  })
  const genesisBlock = await createGenesisBlock([], confOps, threshold);

  const abiCID = randomBytes32Hex();
  const deployCall = factory.deploy(genesisBlock, confAccounts, threshold, name, symbol, abiCID);
  await expect(deployCall).to.not.be.reverted

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

async function deployFs() {
  await deployer.init();
  return await deployer.deployFilesystem();
}

export async function deployEFFixt() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const accSys = await deployAccountSysImpl();
  const wallets = await abi.createWallets(12);
  const fsContract = await deployFs();

  const efChain = await deployEF([
    wallets[0]!,
    wallets[1]!,
    wallets[2]!,
    wallets[3]!,
  ], 3, implLib, accSys, fsContract, "SomeFractal", "SF");

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
    },
    {
      addr: wallets[4]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[5]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[6]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: ZeroAddr,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[7]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[8]!.address,
      metadataId: randomBytes32Hex(),
    },
    {
      addr: wallets[9]!.address,
      metadataId: randomBytes32Hex(),
    }
  ];

  const msgs = accounts.map(account => {
    return createMsg(efChain.chain, 'createAccount', [account])
  });

  const newChain = await createBlockAndExecute(
    efChain,
    msgs,
    efChain.confirmers,
  );

  type AccountWithId = typeof accounts[0] & { id: number };
  const accountsWithIds: AccountWithId[] = [];
  for (const [index, account] of accounts.entries()) {
    const id = await getCreatedAccId(newChain.lastExecTx!, index);
    accountsWithIds.push({ ...account, id });
  }

  return {
    ...efChain,
    latestChain: newChain,
    abiLib, signers,
    wallets,
    accounts: accountsWithIds,
  };
}


describe("EdenPlusFractal", async function() {
  describe("Deployment", async function() {
    it("Should deploy successfuly", async function() {
      await loadFixture(deployEFFixt);
    })
  });

  describe("SubmitResult", async function() {
    it("Should not allow calling submitResults by external actors", async function() {
      const { chain, accounts } = await loadFixture(deployEFFixt);

      const results = [
        {
          delegate: accounts[0]!.id,
          ranks: [
            accounts[0]!.id,
            accounts[1]!.id,
            accounts[2]!.id,
            accounts[3]!.id,
            accounts[4]!.id,
            accounts[5]!.id
          ],
        }
      ];

      await expect(chain.submitResults(results))
        .to.be.revertedWith("Can only be called by self");
    });

    describe("Delegates", async function() {
      it("Should have no delegates in the beginning", async function() {
        const { chain, latestChain } = await loadFixture(deployEFFixt);

        expect((await chain.getDelegates(0)).length).to.be.equal(0);
        expect((await chain.getDelegates(1)).length).to.be.equal(0);
        expect((await chain.getDelegates(2)).length).to.be.equal(0);
        expect((await chain.getDelegates(3)).length).to.be.equal(0);
      })

      it("Should set array of delegates for the last 4 submissions", async function() {
        const { chain, accounts, latestChain, confirmers } = await loadFixture(deployEFFixt);

        ///// Week 1
        let results = [
          {
            delegate: accounts[0]!.id,
            ranks: [
              accounts[0]!.id,
              accounts[1]!.id,
              accounts[2]!.id,
              accounts[3]!.id,
              accounts[4]!.id,
              accounts[5]!.id
            ],
          },
          {
            delegate: accounts[6]!.id,
            ranks: [
              accounts[6]!.id,
              accounts[7]!.id,
              accounts[8]!.id,
              accounts[9]!.id,
              0,
              0
            ],
          },
        ];

        let newChain = await createBlockAndFinalize(
          latestChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );
        await expect(chain.execute(newChain.lastFinalized))
          .to.emit(chain, "ExternalCall");
        newChain.headBlock = newChain.lastFinalized;

        expect(await chain.getDelegate(0, 0)).to.be.equal(accounts[0]!.id);
        expect(await chain.getDelegate(0, 1)).to.be.equal(accounts[6]!.id);

        ///// Week 2
        results = [
          {
            delegate: accounts[3]!.id,
            ranks: [
              accounts[0]!.id,
              accounts[6]!.id,
              accounts[7]!.id,
              accounts[8]!.id,
              0,
              0,
            ],
          },
        ];

        newChain = await createBlockAndExecute(
          newChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );

        // This week
        expect(await chain.getDelegate(0, 0)).to.be.equal(accounts[3]!.id);
        // Previous week
        expect(await chain.getDelegate(1, 0)).to.be.equal(accounts[0]!.id);
        expect(await chain.getDelegate(1, 1)).to.be.equal(accounts[6]!.id);

        ////// Week 3
        results = [
          {
            delegate: accounts[2]!.id,
            ranks: [
              accounts[5]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
          {
            delegate: accounts[7]!.id,
            ranks: [
              accounts[6]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
        ];

        newChain = await createBlockAndExecute(
          newChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );

        // This week
        expect(await chain.getDelegate(0, 0)).to.be.equal(accounts[2]!.id);
        expect(await chain.getDelegate(0, 1)).to.be.equal(accounts[7]!.id);
        // Week 2
        expect(await chain.getDelegate(1, 0)).to.be.equal(accounts[3]!.id);
        // Week 1
        expect(await chain.getDelegate(2, 0)).to.be.equal(accounts[0]!.id);
        expect(await chain.getDelegate(2, 1)).to.be.equal(accounts[6]!.id);

        ///// Week 4
        results = [
          {
            delegate: accounts[9]!.id,
            ranks: [
              accounts[5]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
          {
            delegate: accounts[8]!.id,
            ranks: [
              accounts[6]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
        ];

        newChain = await createBlockAndExecute(
          newChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );

        // Current week
        expect(await chain.getDelegate(0, 0)).to.be.equal(accounts[9]!.id);
        expect(await chain.getDelegate(0, 1)).to.be.equal(accounts[8]!.id);
        // Week 3
        expect(await chain.getDelegate(1, 0)).to.be.equal(accounts[2]!.id);
        expect(await chain.getDelegate(1, 1)).to.be.equal(accounts[7]!.id);
        // Week 2
        expect(await chain.getDelegate(2, 0)).to.be.equal(accounts[3]!.id);
        // Week 1
        expect(await chain.getDelegate(3, 0)).to.be.equal(accounts[0]!.id);
        expect(await chain.getDelegate(3, 1)).to.be.equal(accounts[6]!.id);

        //// Week 5
        results = [
          {
            delegate: accounts[0]!.id,
            ranks: [
              accounts[5]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
          {
            delegate: accounts[1]!.id,
            ranks: [
              accounts[6]!.id,
              0,
              0,
              0,
              0,
              0,
            ],
          },
        ];

        newChain = await createBlockAndExecute(
          newChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );

        // Current week
        expect(await chain.getDelegate(0, 0)).to.be.equal(accounts[0]!.id);
        expect(await chain.getDelegate(0, 1)).to.be.equal(accounts[1]!.id);
        // Week 4
        expect(await chain.getDelegate(1, 0)).to.be.equal(accounts[9]!.id);
        expect(await chain.getDelegate(1, 1)).to.be.equal(accounts[8]!.id);
        // Week 3
        expect(await chain.getDelegate(2, 0)).to.be.equal(accounts[2]!.id);
        expect(await chain.getDelegate(2, 1)).to.be.equal(accounts[7]!.id);
        // Week 2
        expect(await chain.getDelegate(3, 0)).to.be.equal(accounts[3]!.id);
      });
    });

    describe("Rewards for ranks", async function() {
      it("Should issue rewards for ranks", async function() {
        const { chain, accounts, latestChain, confirmers } = await loadFixture(deployEFFixt);

        ///// Week 1
        for (const account of accounts) {
          expect(await chain.balanceOfAccount(account.id)).to.be.equal(0);
        }

        let results = [
          {
            delegate: accounts[0]!.id,
            ranks: [
              accounts[0]!.id,
              accounts[1]!.id,
              accounts[2]!.id,
              accounts[3]!.id,
              accounts[4]!.id,
              accounts[5]!.id
            ],
          },
          {
            delegate: accounts[6]!.id,
            ranks: [
              accounts[6]!.id,
              accounts[7]!.id,
              accounts[8]!.id,
              accounts[9]!.id,
              accounts[10]!.id,
              0,
            ],
          },
        ];

        let newChain = await createBlockAndFinalize(
          latestChain,
          [createMsg(chain, 'submitResults', [results])],
          confirmers,
        );
        await expect(chain.execute(newChain.lastFinalized))
          .to.emit(chain, "ExternalCall");
        newChain.headBlock = newChain.lastFinalized;

        // Room 1
        expect(await chain.balanceOfAccount(accounts[0]!.id)).to.be.equal(2);
        expect(await chain.balanceOfAccount(accounts[1]!.id)).to.be.equal(3);
        expect(await chain.balanceOfAccount(accounts[2]!.id)).to.be.equal(5);
        expect(await chain.balanceOfAccount(accounts[3]!.id)).to.be.equal(8);
        expect(await chain.balanceOfAccount(accounts[4]!.id)).to.be.equal(13);
        expect(await chain.balanceOfAccount(accounts[5]!.id)).to.be.equal(21);
        // Room 2
        expect(await chain.balanceOfAccount(accounts[6]!.id)).to.be.equal(2);
        expect(await chain.balanceOfAccount(accounts[7]!.id)).to.be.equal(3);
        expect(await chain.balanceOfAccount(accounts[8]!.id)).to.be.equal(5);
        expect(await chain.balanceOfAccount(accounts[9]!.id)).to.be.equal(8);
        expect(await chain.balanceOfAccount(accounts[10]!.id)).to.be.equal(13);
      });
    });
  })
});

