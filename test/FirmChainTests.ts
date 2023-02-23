import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { utils, Wallet } from "ethers";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Message, ConfirmerOp, ExtendedBlock, isBlock, ZeroId, } from "../interface/types";
import { decodeConfirmer, getBlockBodyId, getBlockId, getConfirmerSetId, normalizeHexStr, randomBytes32, randomBytes32Hex, sign } from "../interface/abi";
import {
  createAddConfirmerOp, createAddConfirmerOps, createRemoveConfirmerOp,
  createBlock, createMsg, createGenesisBlock, createBlockTemplate, updatedConfirmerSet, createUnsignedBlock, signBlock,
} from "../interface/firmchain";
import { FirmChain, IFirmChain } from "../typechain-types";

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
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<ExtendedBlock> {
  const newBlock = await createBlock(
    prevBlock, messages, signers, confirmerOps, newThreshold
  );
  await extConfirmByAll(newBlock.contract, signers, newBlock);
  return newBlock;
}

export async function createBlockAndFinalize(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<ExtendedBlock> {
  const newBlock = await createBlockAndExtConfirm(
    prevBlock, messages, signers, confirmerOps, newThreshold,
  );
  await expect(newBlock.contract.finalize(newBlock.header)).to.not.be.reverted;
  return newBlock;
}

export async function createBlockAndExecute(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<ExtendedBlock> {
  const newBlock = await createBlockAndExtConfirm(
    prevBlock, messages, signers, confirmerOps, newThreshold,
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

  async function deployChain() {
    const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
    const wallets = await abi.createWallets();

    const factory = await ethers.getContractFactory(
      "FirmChain",
      {
        libraries: { FirmChainImpl: implLib.address }
      }
    );

    // TODO: need to create my own signers (so that I can sign block digests not just eth txs)
    const confOps: ConfirmerOp[] = [
      createAddConfirmerOp(wallets[0], 1),
      createAddConfirmerOp(wallets[1], 1),
      createAddConfirmerOp(wallets[2], 1),
      createAddConfirmerOp(wallets[3], 1),
    ];
    const threshold = 3;
    const genesisBl = await createGenesisBlock([], confOps, threshold);

    const deployCall = factory.deploy(genesisBl, confOps, threshold);
    await expect(deployCall).to.not.be.reverted;
    const chain = await deployCall;
    genesisBl.contract = chain;

    return {
      wallets, chain, implLib, abiLib, signers,
      nextHeader: (await createBlockTemplate(genesisBl as ExtendedBlock)).header,
      genesisBl: genesisBl as ExtendedBlock,
      confs: genesisBl.confirmerSet.confirmers,
      threshold: genesisBl.confirmerSet.threshold,
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
    const fixtureVars = await loadFixture(deployChain);
    const token = await deployToken(fixtureVars.chain.address);
    return { ...fixtureVars, token };
  }

  async function deployFirmChainNTT() {
    const fixtureVars = await loadFixture(deployChain);
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
    const fixtureVars = await loadFixture(deployChain);
    const directory = await deployDirectory();
    return { ...fixtureVars, directory };
  }

  describe("Deployment", async function() {
    it("Should deploy implementation library", async function() {
      await loadFixture(deployImplLib);
    })

    it("Should create new FirmChain successfully", async function() {
      await loadFixture(deployChain);
    })

    it("Should set confirmers", async function() {
      const { chain, confs } = await loadFixture(deployChain);

      const confBytes = await chain.getConfirmers();      

      for (const [index, c] of confBytes.entries()) {
        expect(decodeConfirmer(c)).to.containSubset(confs[index]);
      }
    });

    it("Should set threshold", async function() {
      const { chain, threshold: expThreshold } = await loadFixture(deployChain);

      const threshold = await chain.getThreshold();

      expect(threshold).to.equal(expThreshold);
    });

    it("Should set head", async function() {
      const { chain, genesisBl } = await loadFixture(deployChain);

      const head = await chain.getHead();

      expect(head).to.equal(getBlockId(genesisBl.header));
    });

  });

  describe("isConfirmedBy", async function() {
    it("Should return false for unconfirmed blocks", async function() {
      const { chain, wallets, confs, genesisBl } = await loadFixture(deployChain);

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
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

      const confirmCall = chain.extConfirm(nextHeader, wallets[0].address, 0);
      await expect(confirmCall).to.be.reverted;
    })

    it("Should fail if wrong address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[1].address, 0);
      await expect(confirmCall).to.be.reverted;
    });

    it("Should succeed if signed and matching address is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[0].address, 0);
      await expect(confirmCall).to.not.be.reverted;
    })

    it("Should record confirmation", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

      const header = await sign(wallets[0], nextHeader);

      const confirmCall = chain.extConfirm(header, wallets[0].address, 0);
      await expect(confirmCall).to.not.be.reverted;

      const blockId = getBlockId(header);

      expect(await chain.isConfirmedBy(blockId, wallets[0].address)).to.be.true;
    });

    it("Should record multiple confirmations", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

      const confWallets = [wallets[0], wallets[1], wallets[2]];
      const header = await sign(confWallets, nextHeader);

      await extConfirmByAll(chain, confWallets, header);

      await checkConfirmations(chain, confWallets, header);
      expect(await chain.isConfirmedBy(getBlockId(header), wallets[4].address)).to.be.false;
    });

    it("Should fail if wrong signature index is provided", async function() {
      const { chain, wallets, nextHeader } = await loadFixture(deployChain);

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

  describe("finalize", async function() {
    describe("external confirmations", async function() {
      it("Should fail in case of no confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

        await expect(chain.finalize(nextHeader)).to.be.reverted;
      });

      it("Should succeed after receiving enough external confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;
      });

      it("Should fail in case of not enough external confirmations", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

        const confWallets = [wallets[0], wallets[1]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.be.reverted;
      });

      it("Should record finalization", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalize(header)).to.not.be.reverted;

        const blockId = getBlockId(header);
        expect(await chain.isFinalized(blockId)).to.be.true;
      });

    })
  });

  describe("execute", async function() {
    it("Should execute a block without messages", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

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
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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

          const newConfSet = updatedConfirmerSet(genesisBl.confirmerSet, confOps, 2);
          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(newConfSet.confirmers[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(2);
      });

      it(
        "Should allow firmchain to add confirmers to its own confirmer set",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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

          const newConfSet = updatedConfirmerSet(genesisBl.confirmerSet, confOps, 4);
          const confBytes = await chain.getConfirmers(); 
          for (const [index, c] of confBytes.entries()) {
            expect(decodeConfirmer(c)).to.containSubset(newConfSet.confirmers[index]);
          }
          expect(await chain.getThreshold()).to.be.equal(4);
      });

      it(
        "Should allow firmchain to change threshold",
        async function() {
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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
      const { chain, confs } = await loadFixture(deployChain);

      const ops = [
        createRemoveConfirmerOp(confs[0]),
        createRemoveConfirmerOp(confs[1]),
      ];

      await expect(chain.updateConfirmerSet(ops, 1)).to.be.reverted;
    })
    it("Should not allow adding confirmers for anyone", async function() {
      const { chain, wallets } = await loadFixture(deployChain);

      const ops = [
        createAddConfirmerOp(wallets[0], 3),
      ];

      await expect(chain.updateConfirmerSet(ops, 3)).to.be.reverted;
    })
  });

  describe("finalizeAndExecute", async function() {
    it("Should finalize and execute a block without messages", async function() {
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

        const confWallets = [wallets[0], wallets[1], wallets[2]];
        const header = await sign(confWallets, nextHeader);
        const block = {
          header, msgs: [],
        }

        await extConfirmByAll(chain, confWallets, header);

        await expect(chain.finalizeAndExecute(block)).to.not.be.reverted;
    });

    it("Should update head", async function() {
      const { chain, wallets, genesisBl } = await loadFixture(deployChain);

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
          const { confs, chain, wallets, genesisBl } = await loadFixture(deployChain);

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
        const { chain, wallets, nextHeader } = await loadFixture(deployChain);

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

