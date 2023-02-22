import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { utils } from "ethers";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Call, Confirmer, ConfirmerOp, ZeroId } from "../interface-helpers/types";
import { decodeConfirmer, getBlockBodyId, getBlockId, getConfirmerSetId, normalizeHexStr } from "../interface-helpers/abi";
import { createAddConfirmerOps } from "../interface-helpers/firmchain";

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
    const { signers, implLib, abiLib } = await loadFixture(deployImplLib);

    const factory = await ethers.getContractFactory(
      "FirmChain",
      {
        libraries: { FirmChainImpl: implLib.address }
      }
    );

    // TODO: need to create my own signers (so that I can sign block digests not just eth txs)
    const confs: Confirmer[] = [
      {
        addr: normalizeHexStr(signers[0].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(signers[1].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(signers[2].address),
        weight: 1
      },
      {
        addr: normalizeHexStr(signers[3].address),
        weight: 1
      }
    ];
    const threshold = 3;
    const confSetId = await getConfirmerSetId(confs, threshold);
    const confOps: ConfirmerOp[] = createAddConfirmerOps(confs);

    const calls: Call[] = []
    const bodyId = getBlockBodyId(calls);

    const header: BlockHeader = {
      prevBlockId: ZeroId,
      blockBodyId: bodyId,
      confirmerSetId: confSetId,
      timestamp: await time.latest(),
      sigs: []
    };

    const genesisBl: Block = {
      header,
      calls
    };


    const deployCall = factory.deploy(genesisBl, confOps, threshold);
    await expect(deployCall).to.not.be.reverted;
    const chain = await deployCall;

    return { signers, chain, confs, genesisBl, threshold, implLib, abiLib };
  }

  describe("Deployment", async function() {
    it("Should deploy implementation library", async function() {
      await loadFixture(deployImplLib);
    })

    it("Should create new FirmChain successfully", async function() {
      await loadFixture(deployChain);
    })

    it("Should set confirmers", async function() {
      const { signers, chain, confs } = await loadFixture(deployChain);

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

//   describe("Deployment", async function() {
//     it("Should fail because of wrong confirmerSetId", async function() {
//       const { block, signers, packedConfirmers, factory } = await loadFixture(createGenesisBlock);

//       const goodId = block.confirmerSetId;
//       block.confirmerSetId = utils.solidityKeccak256(["uint8"], ["0x03"]);

//       await expect(factory.deploy(block, { gasLimit: 2552000 })).to.be.revertedWith(
//         "Declared confirmer set does not match computed"
//       );

//       block.confirmerSetId = goodId;
//     });

//     it("Should deploy successfully", async function() {
//       const { block, signers, packedConfirmers, factory } = await loadFixture(createGenesisBlock);

//       await expect(factory.deploy(block, { gasLimit: 9552000 })).to.not.be.reverted;
//     });

//   })

// });

})

