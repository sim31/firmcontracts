import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { utils, Wallet, ContractTransaction } from "ethers";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Message, ConfirmerOp, ExtendedBlock, isBlock, ZeroId, ConfirmerOpValue, ConfirmerValue, AddressStr, Unpromised, isWallet, isWallets, ZeroAddr, BlockBody, ConfirmerStatus, } from "../interface/types";
import { batchSign, decodeConfirmer, getBlockBodyId, getBlockId, getConfirmerSetId, normalizeHexStr, randomBytes32, randomBytes32Hex, sign } from "../interface/abi";
import {
  createAddConfirmerOp, createAddConfirmerOps, createRemoveConfirmerOp,
  createBlock, createMsg, createGenesisBlock, createBlockTemplate, updatedConfirmerSet, createUnsignedBlock, signBlock, toSignedBlocks,
} from "../interface/firmchain";
import { FirmChain, FirmChainImpl, IFirmChain } from "../typechain-types";
import { BlockHeaderStruct } from "../typechain-types/contracts/FirmChainAbi";

export interface ChainInfo {
  confirmers: Wallet[] | ChainInfo[],
  confirmerValues: ConfirmerValue[],
  chain: FirmChain,
  nextHeader: BlockHeaderStruct,
  genesisBl: ExtendedBlock,
  threshold: number,
  headBlock: ExtendedBlock,
  lastFinalized: ExtendedBlock,
  lastExecTx?: ContractTransaction,
}

export async function deployChain(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  implLib: FirmChainImpl
): Promise<ChainInfo> {
  const factory = await ethers.getContractFactory(
    "FirmChain",
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
  genesisBlock.contract = chain;
  const genesisBl = genesisBlock as ExtendedBlock;

  // console.log("genesis header: ", genesisBl.header);

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

export async function deployImplLib() {
  const { signers, abiLib } = await loadFixture(abi.deployAbi);

  const factory = await ethers.getContractFactory(
    "FirmChainImpl",
    {
      libraries: { FirmChainAbi: abiLib.address }
    }
  );
  let implLib;
  expect(implLib = await factory.deploy()).to.not.be.reverted;
  
  return { signers, implLib, abiLib };
}

export async function deploy2ndOrderChain() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const wallets = await abi.createWallets(16);

  const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
  const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
  const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

  const ord2Chain = await deployChain([
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

async function deployChainFixt() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const wallets = await abi.createWallets();

  const r = await deployChain(wallets.slice(0, 4), 3, implLib);

  return {
    ...r, abiLib, signers, implLib, wallets,
  };
}

export async function deployToken(issuer: string) {
  const factory = await ethers.getContractFactory("IssuedToken");
  const deployCall = factory.deploy("Test", "TOK", issuer);
  await expect(deployCall).to.not.be.reverted;
  return await deployCall;
}

export async function deployNTT(issuer: string) {
  const factory = await ethers.getContractFactory("IssuedNTT");
  const deployCall = factory.deploy("Test", "TOK", issuer);
  await expect(deployCall).to.not.be.reverted;
  return await deployCall;
}

async function deployFirmChainToken() {
  const fixtureVars = await loadFixture(deployChainFixt);
  const token = await deployToken(fixtureVars.chain.address);
  return { ...fixtureVars, token };
}

async function deploy2ndOrderChainToken() {
  const fixtureVars = await loadFixture(deploy2ndOrderChain);
  const token = await deployToken(fixtureVars.ord2Chain.chain.address);
  return { ...fixtureVars, token };
}

async function deployFirmChainNTT() {
  const fixtureVars = await loadFixture(deployChainFixt);
  const ntt = await deployNTT(fixtureVars.chain.address);
  return { ...fixtureVars, ntt };
}

export async function extConfirmByAll(chain: IFirmChain, wallets: Wallet[], block: BlockHeader | Block | ExtendedBlock) {
  const header = isBlock(block) ? block.header : block;
  const signatures = 'signatures' in block && block['signatures'].length == wallets.length ? block['signatures'] : undefined;
  for (const [index, wallet] of wallets.entries()) {
    const sig = signatures ? signatures[index] : await sign(wallet, header);
    await expect(chain.extConfirm(header, wallet.address, sig!)).to.not.be.reverted;
  }
}

export async function createBlockAndConfirm(
  chain: ChainInfo,
  messages: Message[],
  signers: Wallet[] | ChainInfo[], // Make sure ChainInfo's have the latest block set as headBlock
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
  updatedSigners?: ChainInfo[], // Where updated versions of signers will be stored (in case they are ChainInfos). Should pass an empty array here.
): Promise<ExtendedBlock> {
  if (!signers.length) {
    throw new Error("Signers cannot be empty");
  }
  if (isWallets(signers)) {
    // console.log("head block: ", chain.headBlock.header);
    const newBlock = await createBlock(
      chain.headBlock, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail,
    );
    await extConfirmByAll(newBlock.contract, signers, newBlock);
    return newBlock;
  } else {
    const newBlock = await createBlock(
      chain.headBlock, messages, [], confirmerOps, newThreshold, ignoreConfirmerSetFail,
    );
    for (const signer of signers) {
      const newSigner = await createBlockAndExecute(
        signer,
        [createMsg(newBlock.contract, 'confirm', [newBlock.header])],
        signer.confirmers
      );
      if (updatedSigners) {
        updatedSigners.push(newSigner);
      }
    }

    return newBlock;
  }
}

export async function createBlockAndFinalize(
  chain: ChainInfo,
  messages: Message[],
  signers: Wallet[] | ChainInfo[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ChainInfo> {
  const updatedSigners: ChainInfo[] = [];
  const newBlock = await createBlockAndConfirm(
    chain, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail, updatedSigners,
  );
  await expect(newBlock.contract.finalize(newBlock.header)).to.not.be.reverted;

  let confirmers = chain.confirmers;
  if (!isWallets(confirmers) && updatedSigners.length) {
    confirmers = confirmers.map((confirmer) => {
      const newConf = updatedSigners.find((s) => s.chain.address === confirmer.chain.address);
      return newConf ? newConf : confirmer;
    });
  }

  return {
    ...chain,
    lastFinalized: newBlock,
    confirmers,
  };
}

export async function createBlockAndExecute(
  chain: ChainInfo,
  messages: Message[],
  signers: Wallet[] | ChainInfo[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ChainInfo> {
  const newChain = await createBlockAndFinalize(
    chain, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail,
  );
  let t;
  await expect(t = newChain.chain.execute(newChain.lastFinalized)).to.not.be.reverted;
  return { ...newChain, headBlock: newChain.lastFinalized, lastExecTx: await t, };
}

export async function checkConfirmations(chain: FirmChain, wallets: Wallet[], header: BlockHeader) {
  const blockId = getBlockId(header);
  for (const wallet of wallets) {
    expect(await chain.isConfirmedBy(blockId, wallet.address)).to.be.true;
  }
}

describe("FirmChain", function () {
  describe("Deployment", async function() {
    it("Should deploy implementation library", async function() {
      await loadFixture(deployImplLib);
    })

    it("Should create new FirmChain successfully", async function() {
      await loadFixture(deployChainFixt);
    })

    it("Should set confirmers", async function() {
      const { chain, confirmerValues } = await loadFixture(deployChainFixt);

      const confBytes = await chain.getConfirmers();      

      for (const [index, c] of confBytes.entries()) {
        expect(decodeConfirmer(c)).to.containSubset(confirmerValues[index]);
      }
    });

    it("Should set threshold", async function() {
      const { chain, threshold: expThreshold } = await loadFixture(deployChainFixt);

      const threshold = await chain.getThreshold();

      expect(threshold).to.equal(expThreshold);
    });

    it("Should set head", async function() {
      const { chain, genesisBl } = await loadFixture(deployChainFixt);

      const head = await chain.getHead();

      expect(head).to.equal(getBlockId(genesisBl.header));
    });

    describe("2nd order chain", async function() {
      it("Should deploy successfully", async function() {
        const {} = await loadFixture(deploy2ndOrderChain);
      });

      it("Should set head", async function() {
        const { ord2Chain } = await loadFixture(deploy2ndOrderChain);

        const head = await ord2Chain.chain.getHead();

        expect(head).to.equal(getBlockId(ord2Chain.genesisBl.header));
      });
    });

    // describe("Deterministic address", async function() {
    //   it("Should deploy at a known address", async function() {
    //     const detFactory = await loadFixture(deployFactory); 

        
    //   });
    // });

  });

  describe("isConfirmedBy", async function() {
    it("Should return false for unconfirmed blocks", async function() {
      const { chain, wallets, confirmerValues, genesisBl } = await loadFixture(deployChainFixt);

      const msgs: Message[] = []
      const body: BlockBody = {
        confirmerSetId: genesisBl.confirmerSetId,
        msgs,
      };
      const bodyId = getBlockBodyId(body);
      const header: BlockHeader = {
        prevBlockId: getBlockId(genesisBl.header),
        blockBodyId: bodyId,
        timestamp: await time.latest(),
      };
      let blockId = getBlockId(header);

      expect(await chain.isConfirmedBy(blockId, confirmerValues[0]!.addr)).to.be.false;
    })
  })

  describe("extConfirm", async function() {
    it("Should fail if wrong address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = {
        ...nextHeader,
        blockBodyId: randomBytes32(),
      }

      const sig = await sign(wallets[0]!, header);

      const confirmCall = chain.extConfirm(header, wallets[1]!.address, sig);
      await expect(confirmCall).to.be.reverted;
    });

    it("Should succeed if signed and matching address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = {
        ...nextHeader,
        blockBodyId: randomBytes32(),
      }

      const sig = await sign(wallets[0]!, header);

      const confirmCall = chain.extConfirm(header, wallets[0]!.address, sig);
      await expect(confirmCall).to.not.be.reverted;
    })

    it("Should record confirmation", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = {
        ...nextHeader,
        blockBodyId: randomBytes32(),
      }

      const sig = await sign(wallets[0]!, header);

      const confirmCall = chain.extConfirm(header, wallets[0]!.address, sig);
      await expect(confirmCall).to.not.be.reverted;

      const blockId = getBlockId(header);

      expect(await chain.isConfirmedBy(blockId, wallets[0]!.address)).to.be.true;
    });

    it("Should record multiple confirmations", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];
      const header = {
        ...nextHeader,
        blockBodyId: randomBytes32(),
      }

      await extConfirmByAll(chain, confWallets, header);

      await checkConfirmations(chain, confWallets, header);
      expect(await chain.isConfirmedBy(getBlockId(header), wallets[4]!.address)).to.be.false;
    });

    it("Should allow confirming blocks after they're finalized", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];
      const header = {
        ...nextHeader,
        blockBodyId: randomBytes32(),
      }

      await extConfirmByAll(chain, confWallets, header);

      await expect(chain.finalize(header)).to.not.be.reverted;

      const sig = await sign(wallets[3]!, header);
      await expect(chain.extConfirm(header, wallets[3]!.address, sig))
        .to.not.be.reverted;

      expect(await chain.isConfirmedBy(getBlockId(header), wallets[3]!.address)).to.be.true;
      expect(await chain.getConfirmerStatus(wallets[3]!.address))
        .to.not.be.equal(ConfirmerStatus.Faulty);
    });

    it("should allow confirming old blocks in the chain", async function() {
      const chain = await loadFixture(deployChainFixt);

      // Execute block confirmed by 3/4 confirmers
      const newChain = await createBlockAndExecute(
        chain,
        [],
        chain.confirmers.slice(0, 3),
      );

      // Confirm and execute next 2 blocks
      const newChain2 = await createBlockAndExecute(
        newChain,
        [],
        chain.confirmers,
      );
      const newChain3 = await createBlockAndExecute(
        newChain2,
        [],
        chain.confirmers,
      );

      const header = newChain.headBlock.header;
      const blockId = getBlockId(header);
      const confirmer = chain.wallets[3]!.address;
      expect(await chain.chain.isConfirmedBy(blockId, confirmer)).to.be.false;
      // Confirm the first block with the last confirmer
      const sig = await sign(chain.wallets[3]!, header);
      await expect(
        chain.chain.extConfirm(newChain.headBlock.header, confirmer, sig)
      ).to.not.be.reverted;
      expect(await chain.chain.isConfirmedBy(blockId, confirmer)).to.be.true;
      expect(await chain.chain.getConfirmerStatus(confirmer))
        .to.not.be.equal(ConfirmerStatus.Faulty);
    });
  });

  describe("confirm", async function() {
    it("Should record a confirmation from another firmchain", async function() {
      const { chain1, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
      
      const block = await createBlock(ord2Chain.genesisBl, [], []);

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

      const newChain1 = await createBlockAndFinalize(
        chain1,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
      );

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

      await expect(chain1.chain.execute(newChain1.lastFinalized)).to.not.be.reverted;

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;
    });

    it('Should emit confirmer fault if it tries to confirm a block which conflicts with finalized block', async () => {
      const { chain1, chain2, chain3, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);

      const block = await createBlock(ord2Chain.genesisBl, [], []);

      await createBlockAndExecute(
        chain1,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
      );
      await createBlockAndExecute(
        chain2,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[4]!, wallets[5]!, wallets[6]!, wallets[7]!],
      );

      await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

      const altBlock = await createBlock(ord2Chain.genesisBl, [], [], [
        createAddConfirmerOp(wallets[0]!.address, 1)
      ]);
      const newChain3 = await createBlockAndFinalize(
        chain3,
        [createMsg(ord2Chain.chain, 'confirm', [altBlock.header])],
        [wallets[8]!, wallets[10]!, wallets[11]!],
      );

      await expect(chain3.chain.execute(newChain3.lastFinalized)).to.emit(ord2Chain.chain, 'ByzantineFault');
    });

    it('Should not record confirmations from faulty firmchains', async () => {
      const { chain1, chain2, chain3, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);

      const block = await createBlock(ord2Chain.genesisBl, [], []);

      const newChain1 = await createBlockAndExecute(
        chain1,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
      );
      await createBlockAndExecute(
        chain2,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[4]!, wallets[5]!, wallets[6]!, wallets[7]!],
      );

      await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

      const altBlock = await createBlock(ord2Chain.genesisBl, [], [], [
        createAddConfirmerOp(wallets[0]!.address, 1)
      ]);
      let newChain3 = await createBlockAndFinalize(
        chain3,
        [createMsg(ord2Chain.chain, 'confirm', [altBlock.header])],
        [wallets[8]!, wallets[10]!, wallets[11]!],
      );

      await expect(newChain3.chain.execute(newChain3.lastFinalized)).to.emit(ord2Chain.chain, 'ByzantineFault');
      newChain3 = { ...newChain3, headBlock: newChain3.lastFinalized };

      
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(altBlock.header), chain3.chain.address)).to.be.false;

      const block2 = await createBlock(block, [], []);
      await createBlockAndExecute(
        newChain1,
        [createMsg(ord2Chain.chain, 'confirm', [block2.header])],
        [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
      );
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block2.header), chain1.chain.address)).to.be.true;

      await createBlockAndExecute(
        newChain3,
        [createMsg(ord2Chain.chain, 'confirm', [block2.header])],
        [wallets[8]!, wallets[10]!, wallets[11]!],
      );
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block2.header), chain3.chain.address)).to.be.false;
    });

    it("Should fail if trying to confirm the same block twice", async function() {
      const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
      const { chain, genesisBl } = ord2Chain;

      const updatedConf = new Array<ChainInfo>();
      const newBlock = await createBlockAndConfirm(
        ord2Chain, [], ord2Chain.confirmers.slice(0, 1),
        undefined, undefined, undefined, updatedConf,
      );

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(newBlock.header), updatedConf[0]!.chain.address)).to.be.true;

      const latestConf = await createBlockAndFinalize(
        updatedConf[0]!,
        [createMsg(newBlock.contract, 'confirm', [newBlock.header])],
        updatedConf[0]!.confirmers,
      );

      await expect(latestConf.chain.execute(latestConf.lastFinalized))
        .to.emit(latestConf.chain, "ExternalCallFail");
    });

    it("Should fail if trying to confirm a block on top of non-finalized block", async function() {
      const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
      const { chain, genesisBl } = ord2Chain;

      const updatedConf = new Array<ChainInfo>();
      const newBlock = await createBlockAndConfirm(
        ord2Chain, [], ord2Chain.confirmers.slice(0, 1),
        undefined, undefined, undefined, updatedConf,
      );

      const newerBlock = await createBlock(newBlock, [], []);

      const latestConf = await createBlockAndFinalize(
        updatedConf[0]!,
        [createMsg(newerBlock.contract, 'confirm', [newerBlock.header])],
        updatedConf[0]!.confirmers,
      );

      await expect(latestConf.chain.execute(latestConf.lastFinalized))
        .to.emit(latestConf.chain, "ExternalCallFail");
      
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(newBlock.header), latestConf.chain.address)).to.be.true;
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(newerBlock.header), latestConf.chain.address)).to.be.false;
    });

    it("Should emit confirmerFault event if trying to confirm two conflicting blocks", async function() {
      const { ord2Chain, signers, chain1 } = await loadFixture(deploy2ndOrderChain);
      const { chain, genesisBl } = ord2Chain;

      const block = await createBlock(genesisBl, [], []);
      const altBlock = await createBlock(genesisBl, [], [], [createAddConfirmerOp(signers[0]!.address, 1)]);

      const newChain1 = await createBlockAndFinalize(
        chain1,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        chain1.confirmers,
      );
      await expect(newChain1.chain.execute(newChain1.lastFinalized)).to.emit(newChain1.chain, "ExternalCall");
      newChain1.headBlock = newChain1.lastFinalized;

      const newChain2 = await createBlockAndFinalize(
        newChain1,
        [createMsg(ord2Chain.chain, 'confirm', [altBlock.header])],
        newChain1.confirmers,
      );
      await expect(newChain2.chain.execute(newChain2.lastFinalized))
        .to.emit(newChain2.chain, "ExternalCall")
        .and
        .to.emit(chain, "ByzantineFault");
    });

    it("Should allow confirming blocks after they're finalized", async function() {
      const { ord2Chain, chain3 } = await loadFixture(deploy2ndOrderChain);

      const newChain1 = await createBlockAndFinalize(
        ord2Chain, [], ord2Chain.confirmers.slice(0, 2),
      );

      const header = newChain1.lastFinalized.header;
      const bId = getBlockId(header);
      expect(await ord2Chain.chain.isConfirmedBy(bId, chain3.chain.address));

      await createBlockAndExecute(
        chain3,
        [createMsg(ord2Chain.chain, 'confirm', [header])],
        chain3.confirmers
      );

      expect(await ord2Chain.chain.isConfirmedBy(bId, chain3.chain.address)).to.be.true;
      expect(await ord2Chain.chain.getConfirmerStatus(chain3.chain.address))
        .to.not.be.equal(ConfirmerStatus.Faulty);
    });

    it("should allow confirming old blocks in the chain", async function() {
      const { ord2Chain, chain3 } = await loadFixture(deploy2ndOrderChain);

      // Execute block confirmed by 3/4 confirmers
      const newChain1 = await createBlockAndExecute(
        ord2Chain,
        [],
        ord2Chain.confirmers.slice(0, 2),
      );

      // Confirm and execute next block
      const newChain2 = await createBlockAndExecute(
        newChain1,
        [],
        newChain1.confirmers.slice(0, 2),
      );

      const header = newChain1.headBlock.header;
      const blockId = getBlockId(header);
      const confirmerAddr = chain3.chain.address
      expect(await newChain2.chain.isConfirmedBy(blockId, confirmerAddr)).to.be.false;

      await createBlockAndExecute(
        chain3,
        [createMsg(newChain2.chain, 'confirm', [header])],
        chain3.confirmers,
      );
      expect(await newChain2.chain.isConfirmedBy(blockId, confirmerAddr)).to.be.true;
      expect(await newChain2.chain.getConfirmerStatus(confirmerAddr))
        .to.not.be.equal(ConfirmerStatus.Faulty);
    });

  });

  describe("finalize", async function() {
    describe("external confirmations", async function() {
      it("Should fail in case of no confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        await expect(chain.finalize(nextHeader)).to.be.reverted;
      });

      it("Should succeed after receiving enough external confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const header = {
          ...nextHeader,
          blockBodyId: randomBytes32(),
        };
        const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;
      });

      it("Should fail in case of not enough external confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const header = {
          ...nextHeader,
          blockBodyId: randomBytes32(),
        };

        const confWallets = [wallets[0]!, wallets[1]!];

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.be.reverted;
      });

      it("Should record finalization", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const header = {
          ...nextHeader,
          blockBodyId: randomBytes32(),
        };

        const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;

        const blockId = getBlockId(header);
        expect(await chain.isFinalized(blockId)).to.be.true;
      });
    })

    describe("2nd order firmchain", async function() {
      it("Should fail in case of not enough confirmations", async function() {
        const { chain1, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
        
        const block = await createBlock(ord2Chain.genesisBl, [], []);

        const chain1Bl = await createBlockAndExecute(
          chain1,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;

        await expect(ord2Chain.chain.finalize(block.header)).to.be.revertedWith(
          "Not enough confirmations"
        );
      });

      it("Should succeed after enough confirmations", async function() {
        const { chain1, chain2, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
        
        const block = await createBlock(ord2Chain.genesisBl, [], []);

        const chain1Bl = await createBlockAndExecute(
          chain1,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;

        const chain2Bl = await createBlockAndExecute(
          chain2,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[4]!, wallets[5]!, wallets[6]!],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain2.chain.address)).to.be.true;

        await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;
      });

      it('Should record finalization', async () => {
        const { chain1, chain2, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
        
        const block = await createBlock(ord2Chain.genesisBl, [], []);

        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

        const chain1Bl = await createBlockAndExecute(
          chain1,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0]!, wallets[1]!, wallets[2]!, wallets[3]!],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;

        const chain2Bl = await createBlockAndExecute(
          chain2,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[4]!, wallets[5]!, wallets[6]!],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain2.chain.address)).to.be.true;

        await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

        expect(await ord2Chain.chain.isFinalized(getBlockId(block.header))).to.be.true;                        
      });
    });
  });

  describe("execute", async function() {
    it("Should execute a block without messages", async function() {
        const { chain, wallets, nextHeader, genesisBl } = await loadFixture(deployChainFixt);

        const body: BlockBody = {
          msgs: [],
          confirmerSetId: genesisBl.confirmerSetId,
        };
        const header = {
          ...nextHeader,
          blockBodyId: getBlockBodyId(body),
        };
        const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];
        const block = {
          ...body,
          header,
        };

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;

        await expect(chain.execute(block)).to.not.be.reverted;
    });

    describe("Minting a token", async function() {
      it(
        "Should emit ContractDoesNotExist event if contract does not exist",
        async function() {
          const { token, chain, wallets, genesisBl } = await loadFixture(deployFirmChainToken);

          const issueMsgData = token.interface.encodeFunctionData('mint', [
            wallets[5]!.address, 10
          ]);
          const msg: Message = {
            addr: wallets[4]!.address,
            cdata: issueMsgData,
          };
          const newBlock = await createBlock(
            genesisBl,
            [msg],
            [wallets[0]!, wallets[1]!, wallets[2]!],
          );
          
          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          await expect(chain.execute(newBlock)).to.emit(chain, "ContractDoesNotExist");
      });

      it(
        "Should emit ExternalCallFail event if message fails",
        async function() {
          const chainInfo = await loadFixture(deployFirmChainToken);
          const { token, chain, confirmers } = chainInfo;

          // Try emitting to zero address
          const newChain1 = await createBlockAndFinalize(
            chainInfo,
            [createMsg(token, 'mint', [ZeroAddr, 10])],
            confirmers,
          );

          await expect(newChain1.chain.execute(newChain1.lastFinalized))
            .to.emit(newChain1.chain, 'ExternalCallFail');
          
        }
      )

      it(
        "Should mint token successfully",
        async function() {
          const { token, chain, wallets, genesisBl } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [wallets[5]!.address, 12])],
            [wallets[0]!, wallets[1]!, wallets[3]!!],
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(newBlock)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(wallets[5]!.address)).to.be.equal(12);
      });

      it(
        "Should mint transferrable token successfully",
        async function() {
          const { token, chain, wallets, genesisBl, signers } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [signers[5]!.address, 10])],
            [wallets[0]!, wallets[1]!, wallets[3]!],
          );
          
          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(newBlock)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(signers[5]!.address)).to.be.equal(10);

          await expect(
            token.connect(signers[5]!).transfer(wallets[4]!.address, 4)
          ).to.not.be.reverted;
          expect(await token.balanceOf(signers[5]!.address)).to.be.equal(6);
          expect(await token.balanceOf(wallets[4]!.address)).to.be.equal(4);
      });

      it("Should fail for un-finalized blocks", async function() {
          const { token, chain, wallets, genesisBl, signers } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [signers[5]!.address, 10])],
            [wallets[0]!, wallets[3]!],
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.be.reverted;

          await expect(chain.execute(newBlock)).to.be.reverted;
      });

      describe("2nd order chains", async function() {
        it("Should mint token successfully", async () => {
          const { token, wallets, ord2Chain } = await loadFixture(deploy2ndOrderChainToken);

          expect(await token.balanceOf(wallets[5]!.address)).to.be.equal(0);

          await createBlockAndExecute(
            ord2Chain,
            [createMsg(token, 'mint', [wallets[5]!.address, 12])],
            ord2Chain.confirmers,
          );

          expect(await token.balanceOf(wallets[5]!.address)).to.be.equal(12);

        });
      });
    });

    describe("Updating confirmer set", async function() {
      it(
        "Should allow firmchain to remove confirmers from its own confirmer set",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confirmerValues[0]!),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 2,
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newBlock)).to.not.be.reverted;

          const newConfSet = updatedConfirmerSet(genesisBl.state.confirmerSet, confOps, 2);
          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(newConfSet.confirmers[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(2);
      });

      it(
        "Should allow firmchain to add confirmers to its own confirmer set",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createAddConfirmerOp(wallets[5]!, 1),
            createAddConfirmerOp(wallets[6]!, 2),
            createAddConfirmerOp(wallets[4]!, 2),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 4,
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newBlock)).to.not.be.reverted;

          const newConfSet = updatedConfirmerSet(genesisBl.state.confirmerSet, confOps, 4);
          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(newConfSet.confirmers[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(4);
      });

      it(
        "Should not allow firmchain to add confirmers which already exist",
        async function() {
          const ch = await loadFixture(deployChainFixt);
          const { chain, wallets, genesisBl } = ch;

          const confOps = [
            createAddConfirmerOp(wallets[5]!, 1),
            createAddConfirmerOp(wallets[6]!, 2),
            createAddConfirmerOp(wallets[1]!, 1),
          ];

          await expect(createBlockAndFinalize(
            ch,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 4,
          )).to.be.rejectedWith("Cannot add a confirmer which already exists");

          const newChain = await createBlockAndFinalize(
            ch,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 4,
            true
          );

          await expect(chain.execute(newChain.lastFinalized)).to.emit(chain, 'ExternalCallFail');
      });

      it(
        "Should not allow to remove confirmers which are not present",
        async function() {
          const ch = await loadFixture(deployChainFixt);
          const { chain, wallets, genesisBl } = ch

          const confOps = [
            createAddConfirmerOp(wallets[5]!, 1),
            createAddConfirmerOp(wallets[6]!, 2),
            createRemoveConfirmerOp(wallets[7]!, 2),
          ];

          await expect(createBlockAndFinalize(
            ch,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 4,
          )).to.be.rejectedWith("Trying to remove a non existing confirmer");

          const newChain = await createBlockAndFinalize(
            ch,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 4,
            true
          );

          await expect(chain.execute(newChain.lastFinalized)).to.emit(chain, "ExternalCallFail");
        }
      )

      it(
        "Should allow firmchain to change threshold",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            [], 4,
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newBlock)).to.not.be.reverted;

          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(confirmerValues[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(4);
      });

      it(
        "Should fail if old confirmerSetId is specified in the block",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confirmerValues[0]!),
          ];

          const newBlock = await createUnsignedBlock(
            genesisBl,
            [],
            confOps, 2,
          );
          newBlock.confirmerSetId = genesisBl.confirmerSetId;
          newBlock.header.blockBodyId = getBlockBodyId(newBlock);
          const newSignedBlock = await signBlock(newBlock, [wallets[0]!, wallets[1]!, wallets[2]!]);


          await extConfirmByAll(chain, newSignedBlock.signers, newSignedBlock.header);
          await expect(chain.finalize(newSignedBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newSignedBlock)).to.be.revertedWith(
            "Confirmer set computed does not match declared",
          );
        })

      it(
        "Should fail if wrong confirmerSetId is specified in the block",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps1 = [
            createRemoveConfirmerOp(confirmerValues[0]!),
            createAddConfirmerOp(wallets[5]!, 1),
          ];
          const confOps2 = [
            createAddConfirmerOp(wallets[5]!, 1),
          ];

          const newBlock = await createUnsignedBlock(
            genesisBl,
            [],
            confOps1, 3,
          );
          const newBlockAlt = await createUnsignedBlock(
            genesisBl,
            [],
            confOps2, 3,
          );
          newBlock.confirmerSetId = newBlockAlt.confirmerSetId;
          newBlock.header.blockBodyId = await getBlockBodyId(newBlock);
          const newSignedBlock = await signBlock(newBlock, [wallets[0]!, wallets[1]!, wallets[2]!]);


          await extConfirmByAll(chain, newSignedBlock.signers, newSignedBlock.header);
          await expect(chain.finalize(newSignedBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newSignedBlock)).to.be.revertedWith(
            "Confirmer set computed does not match declared",
          );
        })

    });
  });

  describe("updateConfirmerSet", async function() {
    it("Should not allow removing confirmers for anyone", async function() {
      const { chain, confirmerValues } = await loadFixture(deployChainFixt);

      const ops = [
        createRemoveConfirmerOp(confirmerValues[0]!),
        createRemoveConfirmerOp(confirmerValues[1]!),
      ];

      await expect(chain.updateConfirmerSet(ops, 1)).to.be.reverted;
    })
    it("Should not allow adding confirmers for anyone", async function() {
      const { chain, wallets } = await loadFixture(deployChainFixt);

      const ops = [
        createAddConfirmerOp(wallets[0]!, 3),
      ];

      await expect(chain.updateConfirmerSet(ops, 3)).to.be.reverted;
    })
  });

  describe("finalizeAndExecute", async function() {
    it("Should finalize and execute a block without messages", async function() {
        const { chain, wallets, nextHeader, genesisBl } = await loadFixture(deployChainFixt);

        const confWallets = [wallets[0]!, wallets[1]!, wallets[2]!];

        const body: BlockBody = {
          confirmerSetId: genesisBl.confirmerSetId,
          msgs: [],
        };
        const header = {
          ...nextHeader,
          blockBodyId: getBlockBodyId(body),
        };

        const block = {
          ...body,
          header,
        };

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalizeAndExecute(block)).to.not.be.reverted;
    });

    it("Should update head", async function() {
      const { chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

      const newBlock = await createBlock(
        genesisBl, [], [wallets[0]!, wallets[2]!, wallets[3]!]
      );

      await extConfirmByAll(chain, newBlock.signers, newBlock);
      await expect(chain.finalizeAndExecute(newBlock)).to.not.be.reverted;

      expect(await chain.getHead()).to.be.equal(getBlockId(newBlock.header));
    })

    describe("Updating confirmer set", async function() {
      it(
        "Should change what confirmations are required",
        async function() {
          const { confirmerValues, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confirmerValues[0]!),
            createAddConfirmerOp(wallets[5]!, 1),
            createAddConfirmerOp(wallets[6]!, 1),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0]!, wallets[1]!, wallets[2]!],
            confOps, 3,
          );
          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalizeAndExecute(newBlock)).to.not.be.reverted;

          // Previous three confirmers should not be enough to finalize now
          // (wallets[0] confirmer was removed)
          const newBlock2 = await createBlock(
            newBlock,
            [],
            newBlock.signers
          );
          await extConfirmByAll(chain, newBlock2.signers, newBlock2.header);
          await expect(chain.finalizeAndExecute(newBlock2)).to.be.revertedWith(
            "Not enough confirmations"
          );

          // Now let's use all current confirmers
          const newBlock21 = await createBlock(
            newBlock,
            [],
            [wallets[3]!, wallets[5]!, wallets[6]!],
          );
          await extConfirmByAll(chain, newBlock21.signers, newBlock21.header);
          await expect(chain.finalizeAndExecute(newBlock21)).to.not.be.reverted;
      });
    });

    describe("IssuedNTT", async function() {
      it("Should allow issuing NTT", async function() {
        const ch = await loadFixture(deployFirmChainNTT);
        const { ntt, genesisBl, wallets, signers } = ch;

        expect(await ntt.balanceOf(signers[0]!.address)).to.equal(0);

        await createBlockAndExecute(
          ch,
          [createMsg(ntt, 'mint', [signers[0]!.address, 2])],
          [wallets[0]!, wallets[1]!, wallets[2]!],
        );

        expect(await ntt.balanceOf(signers[0]!.address)).to.equal(2);

        await expect(
          ntt.connect(signers[0]!).transfer(signers[1]!.address, 1)
        ).to.be.revertedWith("Only minting allowed");
      });
    });
  });

  describe("isFinalized", async function() {
    it("Should return false for non-finalized blocks", async function() {
        const { chain, wallets, nextHeader, genesisBl } = await loadFixture(deployChainFixt);

        expect(await chain.isFinalized(getBlockId(nextHeader))).to.be.false;

        const confWallets = [wallets[0]!, wallets[1]!];

        const body: BlockBody = {
          confirmerSetId: genesisBl.confirmerSetId,
          msgs: []
        };
        const header = { ...nextHeader, blockBodyId: getBlockBodyId(body) };

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.be.reverted;

        const blockId = getBlockId(header);
        expect(await chain.isFinalized(blockId)).to.be.false;
    });

  });

  describe("sync", async function() {
    it("Should finalize and execute multiple blocks in a single tx", async function () {
      const ch = await loadFixture(deployFirmChainNTT);
      const { ntt, genesisBl, wallets, signers, headBlock } = ch;

      expect(await ntt.balanceOf(signers[0]!.address)).to.equal(0);

      const newBlock = await createBlock(
        headBlock, [], wallets
      );

      const newBlock2 = await createBlock(
        newBlock,
        [createMsg(ntt, 'mint', [signers[0]!.address, 2])],
        wallets
      );

      const newBlock3 = await createBlock(
        newBlock2,
        [createMsg(ntt, 'mint', [signers[0]!.address, 2])],
        wallets
      );

      const signedBlocks = toSignedBlocks([
        newBlock, newBlock2, newBlock3
      ]);
      await expect(ch.chain.sync(signedBlocks)).to.not.be.reverted;

      expect(await ntt.balanceOf(signers[0]!.address)).to.equal(4);
    });
  });
})

