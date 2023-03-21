import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { utils, Wallet } from "ethers";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Message, ConfirmerOp, ExtendedBlock, isBlock, ZeroId, ConfirmerOpValue, ConfirmerValue, AddressStr, } from "../interface/types";
import { decodeConfirmer, getBlockBodyId, getBlockId, getConfirmerSetId, normalizeHexStr, randomBytes32, randomBytes32Hex, sign } from "../interface/abi";
import {
  createAddConfirmerOp, createAddConfirmerOps, createRemoveConfirmerOp,
  createBlock, createMsg, createGenesisBlock, createBlockTemplate, updatedConfirmerSet, createUnsignedBlock, signBlock,
} from "../interface/firmchain";
import { FirmChain, FirmChainImpl, IFirmChain } from "../typechain-types";

export async function extConfirmByAll(chain: IFirmChain, wallets: Wallet[], block: BlockHeader | Block) {
  const header = isBlock(block) ? block.header : block;
  for (const [index, wallet] of wallets.entries()) {
    await expect(chain.extConfirm(header, wallet.address, index)).to.not.be.reverted;
  }
}

export async function createBlockAndExtConfirm(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ExtendedBlock> {
  const newBlock = await createBlock(
    prevBlock, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail,
  );
  await extConfirmByAll(newBlock.contract, signers, newBlock);
  return newBlock;
}

export async function createBlockAndFinalize(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ExtendedBlock> {
  const newBlock = await createBlockAndExtConfirm(
    prevBlock, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail,
  );
  await expect(newBlock.contract.finalize(newBlock.header)).to.not.be.reverted;
  return newBlock;
}

export async function createBlockAndExecute(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ExtendedBlock> {
  const newBlock = await createBlockAndExtConfirm(
    prevBlock, messages, signers, confirmerOps, newThreshold, ignoreConfirmerSetFail,
  );
  await expect(newBlock.contract.finalizeAndExecute(newBlock)).to.not.be.reverted;
  return newBlock;
}

export async function checkConfirmations(chain: FirmChain, wallets: Wallet[], header: BlockHeader) {
  const blockId = getBlockId(header);
  for (const wallet of wallets) {
    expect(await chain.isConfirmedBy(blockId, wallet.address)).to.be.true;
  }
}

describe("FirmChain", function () {
  async function deployImplLib() {
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

  async function deployChain(
    wallets: Wallet[] | AddressStr[],
    threshold: number,
    implLib: FirmChainImpl) {
    const factory = await ethers.getContractFactory(
      "FirmChain",
      {
        libraries: { FirmChainImpl: implLib.address }
      }
    );

    const confOps: ConfirmerOpValue[] = wallets.map((wallet) => {
      return createAddConfirmerOp(wallet, 1);
    });
    const genesisBl = await createGenesisBlock([], confOps, threshold);

    const deployCall = factory.deploy(genesisBl, confOps, threshold);
    await expect(deployCall).to.not.be.reverted;
    const chain = await deployCall;
    genesisBl.contract = chain;

    return {
      wallets, chain, implLib,
      nextHeader: (await createBlockTemplate(genesisBl as ExtendedBlock)).header,
      genesisBl: genesisBl as ExtendedBlock,
      confs: genesisBl.state.confirmerSet.confirmers,
      threshold: genesisBl.state.confirmerSet.threshold,
    };
  }

  async function deployChainFixt() {
    const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
    const wallets = await abi.createWallets();

    const r = await deployChain(wallets.slice(0, 4), 3, implLib);

    return {
      ...r, abiLib, signers,
      wallets,
    };
  }

  async function deploy2ndOrderChain() {
    const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
    const wallets = await abi.createWallets(16);

    const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
    const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
    const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

    const ord2Chain = await deployChain([
      chain1.chain.address,
      chain2.chain.address,
      chain3.chain.address,
    ], 2, implLib);

    return {
      chain1, chain2, chain3,
      ord2Chain,
      abiLib, signers,
      wallets,
    };
  }

  async function deployToken(issuer: string) {
    const factory = await ethers.getContractFactory("IssuedToken");
    const deployCall = factory.deploy("Test", "TOK", issuer);
    await expect(deployCall).to.not.be.reverted;
    return await deployCall;
  }

  async function deployNTT(issuer: string) {
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

  async function deployFirmChainNTT() {
    const fixtureVars = await loadFixture(deployChainFixt);
    const ntt = await deployNTT(fixtureVars.chain.address);
    return { ...fixtureVars, ntt };
  }

  async function deployDirectory() {
    const factory = await ethers.getContractFactory("Directory");
    const deployCall = factory.deploy();
    await expect(deployCall).to.not.be.reverted;
    return await deployCall;
  }

  async function deployFirmChainWithDir() {
    const fixtureVars = await loadFixture(deployChainFixt);
    const directory = await deployDirectory();
    return { ...fixtureVars, directory };
  }

  describe("Deployment", async function() {
    it("Should deploy implementation library", async function() {
      await loadFixture(deployImplLib);
    })

    it("Should create new FirmChain successfully", async function() {
      await loadFixture(deployChainFixt);
    })

    it("Should set confirmers", async function() {
      const { chain, confs } = await loadFixture(deployChainFixt);

      const confBytes = await chain.getConfirmers();      

      for (const [index, c] of confBytes.entries()) {
        expect(decodeConfirmer(c)).to.containSubset(confs[index]);
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
    })

  });

  describe("isConfirmedBy", async function() {
    it("Should return false for unconfirmed blocks", async function() {
      const { chain, wallets, confs, genesisBl } = await loadFixture(deployChainFixt);

      const msgs: Message[] = []
      const bodyId = getBlockBodyId(msgs);
      const header: BlockHeader = {
        prevBlockId: getBlockId(genesisBl.header),
        blockBodyId: bodyId,
        confirmerSetId: genesisBl.header.confirmerSetId,
        timestamp: await time.latest(),
        sigs: []
      };
      let blockId = getBlockId(header);

      expect(await chain.isConfirmedBy(blockId, confs[0].addr)).to.be.false;
    })
  })

  describe("extConfirm", async function() {
    it("Should fail if block has no signatures", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const confirmCall = chain.extConfirm(nextHeader, wallets[0].address, 0);
      await expect(confirmCall).to.be.reverted;
    })

    it("Should fail if wrong address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[1].address, 0);
      await expect(confirmCall).to.be.reverted;
    });

    it("Should succeed if signed and matching address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[0].address, 0);
      await expect(confirmCall).to.not.be.reverted;
    })

    it("Should record confirmation", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[0].address, 0);
      await expect(confirmCall).to.not.be.reverted;

      const blockId = getBlockId(header);

      expect(await chain.isConfirmedBy(blockId, wallets[0].address)).to.be.true;
    });

    it("Should record multiple confirmations", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const confWallets = [wallets[0], wallets[1], wallets[2]];
      const header = await sign(confWallets, nextHeader);

      await extConfirmByAll(chain, confWallets, header);

      await checkConfirmations(chain, confWallets, header);
      expect(await chain.isConfirmedBy(getBlockId(header), wallets[4].address)).to.be.false;
    });

    it("Should fail if wrong signature index is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

      const confWallets = [wallets[0], wallets[1], wallets[2]];
      const header = await sign(confWallets, nextHeader);

      await expect(chain.extConfirm(header, wallets[0].address, 1)).to.be.reverted;
      await expect(chain.extConfirm(header, wallets[0].address, 2)).to.be.reverted;
      await expect(chain.extConfirm(header, wallets[1].address, 0)).to.be.reverted;
      await expect(chain.extConfirm(header, wallets[1].address, 2)).to.be.reverted;
      await expect(chain.extConfirm(header, wallets[1].address, 3)).to.be.reverted;
      await expect(chain.extConfirm(header, wallets[1].address, 4)).to.be.reverted;
    });
  });

  describe("confirm", async function() {
    describe("Confirmations from external accounts", async function() {
      it("Should record a confirmation from external account", async function() {
        const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
        const { chain, genesisBl } = ord2Chain;

        const block = await createBlock(genesisBl, [], []);

        await expect(chain.connect(signers[0]).confirm(block.header)).to.not.be.reverted;

        expect(await chain.isConfirmedBy(getBlockId(block.header), signers[0].address)).to.be.true;
      });

      it("Should fail if trying to confirm the same block twice", async function() {
        const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
        const { chain, genesisBl } = ord2Chain;

        const block = await createBlock(genesisBl, [], []);

        await expect(chain.connect(signers[0]).confirm(block.header)).to.not.be.reverted;

        await expect(chain.connect(signers[0]).confirm(block.header)).to.be.revertedWith("Block already confirmed by this confirmer");
      });

      it("Should fail if trying to confirm a block on top of non-finalized block", async function() {
        const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
        const { chain, genesisBl } = ord2Chain;

        const block = await createBlock(genesisBl, [], []);

        await expect(chain.connect(signers[0]).confirm(block.header)).to.not.be.reverted;

        const block2 = await createBlock(block, [], []);

        await expect(chain.connect(signers[0]).confirm(block2.header)).to.be.revertedWith(
          "Previous block has to be finalized."
        );
      });

      it("Should emit confirmerFault event if trying to confirm two conflicting blocks", async function() {
        const { ord2Chain, signers } = await loadFixture(deploy2ndOrderChain);
        const { chain, genesisBl } = ord2Chain;

        const block = await createBlock(genesisBl, [], []);
        const altBlock = await createBlock(genesisBl, [], [], [createAddConfirmerOp(signers[0].address, 1)]);

        await expect(chain.connect(signers[0]).confirm(block.header)).to.not.be.reverted;

        await expect(chain.connect(signers[0]).confirm(altBlock.header)).to.emit(chain, "ByzantineFault");
      });

    // TODO: Confirmer should not be able to confirm after he's marked as faulty
    });

    it("Should record a confirmation from another firmchain", async function() {
      const { chain1, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
      
      const block = await createBlock(ord2Chain.genesisBl, [], []);

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

      const chain1Bl = await createBlockAndFinalize(
        chain1.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0], wallets[1], wallets[2], wallets[3]],
      );

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

      await expect(chain1.chain.execute(chain1Bl)).to.not.be.reverted;

      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;
    });

    it('Should emit confirmer fault if it tries to confirm a block which conflicts with finalized block', async () => {
      const { chain1, chain2, chain3, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);

      const block = await createBlock(ord2Chain.genesisBl, [], []);

      await createBlockAndExecute(
        chain1.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0], wallets[1], wallets[2], wallets[3]],
      );
      await createBlockAndExecute(
        chain2.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[4], wallets[5], wallets[6], wallets[7]],
      );

      await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

      const altBlock = await createBlock(ord2Chain.genesisBl, [], [], [
        createAddConfirmerOp(wallets[0].address, 1)
      ]);
      const chain3Bl = await createBlockAndFinalize(
        chain3.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [altBlock.header])],
        [wallets[8], wallets[10], wallets[11]],
      );

      await expect(chain3.chain.execute(chain3Bl)).to.emit(ord2Chain.chain, 'ByzantineFault');
    });

    it('Should not record confirmations from faulty firmchains', async () => {
      const { chain1, chain2, chain3, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);

      const block = await createBlock(ord2Chain.genesisBl, [], []);

      const chain1Bl = await createBlockAndExecute(
        chain1.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[0], wallets[1], wallets[2], wallets[3]],
      );
      await createBlockAndExecute(
        chain2.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [block.header])],
        [wallets[4], wallets[5], wallets[6], wallets[7]],
      );

      await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

      const altBlock = await createBlock(ord2Chain.genesisBl, [], [], [
        createAddConfirmerOp(wallets[0].address, 1)
      ]);
      const chain3Bl = await createBlockAndFinalize(
        chain3.genesisBl,
        [createMsg(ord2Chain.chain, 'confirm', [altBlock.header])],
        [wallets[8], wallets[10], wallets[11]],
      );

      await expect(chain3.chain.execute(chain3Bl)).to.emit(ord2Chain.chain, 'ByzantineFault');
      
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(altBlock.header), chain3.chain.address)).to.be.false;

      const block2 = await createBlock(block, [], []);
      await createBlockAndExecute(
        chain1Bl,
        [createMsg(ord2Chain.chain, 'confirm', [block2.header])],
        [wallets[0], wallets[1], wallets[2], wallets[3]],
      );
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block2.header), chain1.chain.address)).to.be.true;

      await createBlockAndExecute(
        chain3Bl,
        [createMsg(ord2Chain.chain, 'confirm', [block2.header])],
        [wallets[8], wallets[10], wallets[11]],
      );
      expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block2.header), chain3.chain.address)).to.be.false;
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

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;
      });

      it("Should fail in case of not enough external confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const confWallets = [wallets[0], wallets[1]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.be.reverted;
      });

      it("Should record finalization", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);

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
          chain1.genesisBl,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0], wallets[1], wallets[2], wallets[3]],
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
          chain1.genesisBl,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0], wallets[1], wallets[2], wallets[3]],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;

        const chain2Bl = await createBlockAndExecute(
          chain2.genesisBl,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[4], wallets[5], wallets[6]],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain2.chain.address)).to.be.true;

        await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;
      });

      it('Should record finalization', async () => {
        const { chain1, chain2, ord2Chain, wallets } = await loadFixture(deploy2ndOrderChain);
        
        const block = await createBlock(ord2Chain.genesisBl, [], []);

        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.false;

        const chain1Bl = await createBlockAndExecute(
          chain1.genesisBl,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[0], wallets[1], wallets[2], wallets[3]],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain1.chain.address)).to.be.true;

        const chain2Bl = await createBlockAndExecute(
          chain2.genesisBl,
          [createMsg(ord2Chain.chain, 'confirm', [block.header])],
          [wallets[4], wallets[5], wallets[6]],
        );
        expect(await ord2Chain.chain.isConfirmedBy(getBlockId(block.header), chain2.chain.address)).to.be.true;

        await expect(ord2Chain.chain.finalize(block.header)).to.not.be.reverted;

        expect(await ord2Chain.chain.isFinalized(getBlockId(block.header))).to.be.true;                        
      });
    });
  });

  describe("execute", async function() {
    it("Should execute a block without messages", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);
        const block = {
          header, msgs: [],
        }

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
            wallets[5].address, 10
          ]);
          const msg: Message = {
            addr: wallets[4].address,
            cdata: issueMsgData,
          };
          const newBlock = await createBlock(
            genesisBl,
            [msg],
            [wallets[0], wallets[1], wallets[2]],
          );
          
          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          await expect(chain.execute(newBlock)).to.emit(chain, "ContractDoesNotExist");
      });

      it(
        "Should mint token successfully",
        async function() {
          const { token, chain, wallets, genesisBl } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [wallets[5].address, 12])],
            [wallets[0], wallets[1], wallets[3]],
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(newBlock)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(wallets[5].address)).to.be.equal(12);
      });

      it(
        "Should mint transferrable token successfully",
        async function() {
          const { token, chain, wallets, genesisBl, signers } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [signers[5].address, 10])],
            [wallets[0], wallets[1], wallets[3]],
          );
          
          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(newBlock)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(signers[5].address)).to.be.equal(10);

          await expect(
            token.connect(signers[5]).transfer(wallets[4].address, 4)
          ).to.not.be.reverted;
          expect(await token.balanceOf(signers[5].address)).to.be.equal(6);
          expect(await token.balanceOf(wallets[4].address)).to.be.equal(4);
      });

      it("Should fail for un-finalized blocks", async function() {
          const { token, chain, wallets, genesisBl, signers } = await loadFixture(deployFirmChainToken);

          const newBlock = await createBlock(
            genesisBl,
            [createMsg(token, 'mint', [signers[5].address, 10])],
            [wallets[0], wallets[3]],
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.be.reverted;

          await expect(chain.execute(newBlock)).to.be.reverted;
      });
    });

    describe("Updating confirmer set", async function() {
      it(
        "Should allow firmchain to remove confirmers from its own confirmer set",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confs[0]),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
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
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createAddConfirmerOp(wallets[5], 1),
            createAddConfirmerOp(wallets[6], 2),
            createAddConfirmerOp(wallets[4], 2),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
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
          const { chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createAddConfirmerOp(wallets[5], 1),
            createAddConfirmerOp(wallets[6], 2),
            createAddConfirmerOp(wallets[1], 1),
          ];

          await expect(createBlockAndFinalize(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
            confOps, 4,
          )).to.be.rejectedWith("Cannot add a confirmer which already exists");

          const block = await createBlockAndFinalize(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
            confOps, 4,
            true
          );

          await expect(chain.execute(block)).to.emit(chain, 'ExternalCallFail');
      });

      it(
        "Should not allow to remove confirmers which are not present",
        async function() {
          const { chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createAddConfirmerOp(wallets[5], 1),
            createAddConfirmerOp(wallets[6], 2),
            createRemoveConfirmerOp(wallets[7], 2),
          ];

          await expect(createBlockAndFinalize(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
            confOps, 4,
          )).to.be.rejectedWith("Trying to remove a non existing confirmer");

          const block = await createBlockAndFinalize(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
            confOps, 4,
            true
          );

          await expect(chain.execute(block)).to.emit(chain, "ExternalCallFail");
        }
      )

      it(
        "Should allow firmchain to change threshold",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
            [], 4,
          );

          await extConfirmByAll(chain, newBlock.signers, newBlock.header);
          await expect(chain.finalize(newBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newBlock)).to.not.be.reverted;

          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(confs[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(4);
      });

      it(
        "Should fail if old confirmerSetId is specified in the block",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confs[0]),
          ];

          const newBlock = await createUnsignedBlock(
            genesisBl,
            [],
            confOps, 2,
          );
          newBlock.header.confirmerSetId = genesisBl.header.confirmerSetId;
          const newSignedBlock = await signBlock(newBlock, [wallets[0], wallets[1], wallets[2]]);


          await extConfirmByAll(chain, newSignedBlock.signers, newSignedBlock.header);
          await expect(chain.finalize(newSignedBlock.header)).to.not.be.reverted;

          await expect(chain.execute(newSignedBlock)).to.be.revertedWith(
            "Confirmer set computed does not match declared",
          );
        })

      it(
        "Should fail if wrong confirmerSetId is specified in the block",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps1 = [
            createRemoveConfirmerOp(confs[0]),
            createAddConfirmerOp(wallets[5], 1),
          ];
          const confOps2 = [
            createAddConfirmerOp(wallets[5], 1),
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
          newBlock.header.confirmerSetId = newBlockAlt.header.confirmerSetId;
          const newSignedBlock = await signBlock(newBlock, [wallets[0], wallets[1], wallets[2]]);


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
      const { chain, confs } = await loadFixture(deployChainFixt);

      const ops = [
        createRemoveConfirmerOp(confs[0]),
        createRemoveConfirmerOp(confs[1]),
      ];

      await expect(chain.updateConfirmerSet(ops, 1)).to.be.reverted;
    })
    it("Should not allow adding confirmers for anyone", async function() {
      const { chain, wallets } = await loadFixture(deployChainFixt);

      const ops = [
        createAddConfirmerOp(wallets[0], 3),
      ];

      await expect(chain.updateConfirmerSet(ops, 3)).to.be.reverted;
    })
  });

  describe("finalizeAndExecute", async function() {
    it("Should finalize and execute a block without messages", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);
        const block = {
          header, msgs: [],
        }

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalizeAndExecute(block)).to.not.be.reverted;
    });

    it("Should update head", async function() {
      const { chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

      const newBlock = await createBlock(
        genesisBl, [], [wallets[0], wallets[2], wallets[3]]
      );

      await extConfirmByAll(chain, newBlock.signers, newBlock);
      await expect(chain.finalizeAndExecute(newBlock)).to.not.be.reverted;

      expect(await chain.getHead()).to.be.equal(getBlockId(newBlock.header));
    })

    describe("Updating confirmer set", async function() {
      it(
        "Should change what confirmations are required",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChainFixt);

          const confOps = [
            createRemoveConfirmerOp(confs[0]),
            createAddConfirmerOp(wallets[5], 1),
            createAddConfirmerOp(wallets[6], 1),
          ];

          const newBlock = await createBlock(
            genesisBl,
            [],
            [wallets[0], wallets[1], wallets[2]],
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
            [wallets[3], wallets[5], wallets[6]],
          );
          await extConfirmByAll(chain, newBlock21.signers, newBlock21.header);
          await expect(chain.finalizeAndExecute(newBlock21)).to.not.be.reverted;
      });
    });

    describe("Directory", async function() {
      it("Should allow setting link to firmchain directory", async function() {
        const { directory, genesisBl, wallets, chain } = await loadFixture(deployFirmChainWithDir);

        expect(await directory.linkOf(chain.address)).to.equal(ZeroId);

        const newLink = randomBytes32Hex();
        await createBlockAndExecute(
          genesisBl,
          [createMsg(directory, 'setLink', [newLink])],
          [wallets[0], wallets[1], wallets[2]],
        );

        expect(await directory.linkOf(chain.address)).to.equal(newLink);
      });
    });

    describe("IssuedNTT", async function() {
      it("Should allow issuing NTT", async function() {
        const { ntt, genesisBl, wallets, signers } = await loadFixture(deployFirmChainNTT);

        expect(await ntt.balanceOf(signers[0].address)).to.equal(0);

        await createBlockAndExecute(
          genesisBl,
          [createMsg(ntt, 'mint', [signers[0].address, 2])],
          [wallets[0], wallets[1], wallets[2]],
        );

        expect(await ntt.balanceOf(signers[0].address)).to.equal(2);

        await expect(
          ntt.connect(signers[0]).transfer(signers[1].address, 1)
        ).to.be.revertedWith("Only minting allowed");
      });
    });
  });

  describe("isFinalized", async function() {
    it("Should return false for non-finalized blocks", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChainFixt);

        expect(await chain.isFinalized(getBlockId(nextHeader))).to.be.false;

        const confWallets = [wallets[0], wallets[1]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.be.reverted;

        const blockId = getBlockId(header);
        expect(await chain.isFinalized(blockId)).to.be.false;
    });

  });
})

