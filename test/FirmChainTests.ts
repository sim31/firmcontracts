import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import * as abi from "./FirmChainAbiTests";
import { Block, BlockHeader, Call, Confirmer, ConfirmerOp, ZeroId } from "../interface-helpers/types";
import { getBlockBodyId, getConfirmerSetId } from "../interface-helpers/abi";
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
        addr: signers[0].address,
        weight: 1
      },
      {
        addr: signers[1].address,
        weight: 1
      },
      {
        addr: signers[2].address,
        weight: 1
      },
      {
        addr: signers[3].address,
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


    let chain;
    const deployCall = factory.deploy(genesisBl, confOps, threshold);
    await expect(deployCall).to.not.be.reverted;
  }

  describe("Deployment", async function() {
    it("Should deploy implementation library", async function() {
      await loadFixture(deployImplLib);
    })

    it("Should create new FirmChain successfully", async function() {
      await loadFixture(deployChain);
    })

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

