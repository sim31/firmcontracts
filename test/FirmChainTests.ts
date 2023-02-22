import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { utils, Wallet } from "ethers";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Message, Confirmer, ConfirmerOp, ZeroId } from "../interface-helpers/types";
import { decodeConfirmer, getBlockBodyId, getBlockId, getConfirmerSetId, normalizeHexStr, sign } from "../interface-helpers/abi";
import { createAddConfirmerOps } from "../interface-helpers/firmchain";
import { FirmChain } from "../typechain-types";

export async function extConfirmByAll(chain: FirmChain, wallets: Wallet[], header: BlockHeader) {
  for (const [index, wallet] of wallets.entries()) {
    await expect(chain.extConfirm(header, wallet.address, index)).to.not.be.reverted;
  }
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
    const confs: Confirmer[] = [
      {
        addr: normalizeHexStr(wallets[0].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(wallets[1].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(wallets[2].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(wallets[3].address),
        weight: 1
      }
    ];
    const threshold = 3;
    const confSetId = await getConfirmerSetId(confs, threshold);
    const confOps: ConfirmerOp[] = createAddConfirmerOps(confs);

    const msgs: Message[] = []
    const bodyId = getBlockBodyId(msgs);

    const header: BlockHeader = {
      prevBlockId: ZeroId,
      blockBodyId: bodyId,
      confirmerSetId: confSetId,
      timestamp: await time.latest(),
      sigs: []
    };

    const genesisBl: Block = {
      header,
      msgs
    };


    const deployCall = factory.deploy(genesisBl, confOps, threshold);
    await expect(deployCall).to.not.be.reverted;
    const chain = await deployCall;

    const nextHeader: BlockHeader = {
      prevBlockId: getBlockId(genesisBl.header),
      blockBodyId: bodyId,
      confirmerSetId: genesisBl.header.confirmerSetId,
      timestamp: await time.latest(),
      sigs: []
    };

    return { wallets, chain, confs, genesisBl, nextHeader, threshold, implLib, abiLib, signers };
  }

  async function deployToken(issuer: string) {
    const factory = await ethers.getContractFactory("IssuedToken");
    const deployCall = factory.deploy("Test", "TOK", issuer);
    await expect(deployCall).to.not.be.reverted;
    return await deployCall;
  }

  async function deployFirmChainToken() {
    const fixtureVars = await loadFixture(deployChain);
    const token = await deployToken(fixtureVars.chain.address);
    return { ...fixtureVars, token };
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
          const { token, chain, wallets, nextHeader, implLib } = await loadFixture(deployFirmChainToken);

          const issueMsgData = token.interface.encodeFunctionData('mint', [
            wallets[5].address, 10
          ]);
          const msg: Message = {
            addr: wallets[4].address,
            cdata: issueMsgData,
          };
          const msgs = [msg];
          const bodyId = getBlockBodyId(msgs);
          let header: BlockHeader = { ...nextHeader, blockBodyId: bodyId };
          const confWallets = [wallets[0], wallets[1], wallets[3]];
          header = await sign(confWallets, header);
          const block: Block = {
            header,
            msgs,
          };
          
          await extConfirmByAll(chain, confWallets, header);
          await expect(chain.finalize(header)).to.not.be.reverted;
          await expect(chain.execute(block)).to.emit(chain, "ContractDoesNotExist");
      });

      it(
        "Should mint token successfully",
        async function() {
          const { token, chain, wallets, nextHeader, implLib } = await loadFixture(deployFirmChainToken);

          const issueMsgData = token.interface.encodeFunctionData('mint', [
            wallets[5].address, 10
          ]);
          const msg: Message = {
            addr: token.address,
            cdata: issueMsgData,
          };
          const msgs = [msg];
          const bodyId = getBlockBodyId(msgs);
          let header: BlockHeader = { ...nextHeader, blockBodyId: bodyId };
          const confWallets = [wallets[0], wallets[1], wallets[3]];
          header = await sign(confWallets, header);
          const block: Block = {
            header,
            msgs,
          };
          
          await extConfirmByAll(chain, confWallets, header);
          await expect(chain.finalize(header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(block)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(wallets[5].address)).to.be.equal(10);
      });

      it(
        "Should mint transferrable token successfully",
        async function() {
          const { token, chain, wallets, nextHeader, implLib, signers } = await loadFixture(deployFirmChainToken);

          const issueMsgData = token.interface.encodeFunctionData('mint', [
            signers[5].address, 10
          ]);
          const msg: Message = {
            addr: token.address,
            cdata: issueMsgData,
          };
          const msgs = [msg];
          const bodyId = getBlockBodyId(msgs);
          let header: BlockHeader = { ...nextHeader, blockBodyId: bodyId };
          const confWallets = [wallets[0], wallets[1], wallets[3]];
          header = await sign(confWallets, header);
          const block: Block = {
            header,
            msgs,
          };
          
          await extConfirmByAll(chain, confWallets, header);
          await expect(chain.finalize(header)).to.not.be.reverted;
          // If event is emitted that means the call did not fail
          await expect(chain.execute(block)).to.emit(chain, "ExternalCall");
          expect(await token.balanceOf(signers[5].address)).to.be.equal(10);

          await expect(
            token.connect(signers[5]).transfer(wallets[4].address, 4)
          ).to.not.be.reverted;
          expect(await token.balanceOf(signers[5].address)).to.be.equal(6);
          expect(await token.balanceOf(wallets[4].address)).to.be.equal(4);
      });
    });
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

