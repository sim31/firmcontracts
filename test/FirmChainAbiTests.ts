import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";
import { utils, Wallet } from 'ethers';
import {
  encodeBlockBody, encodeConfirmer, encodeHeader, getBlockBodyId, getBlockDigest, getBlockId,
  getConfirmerSetId, normalizeHexStr, randomBytes32, randomBytes32Hex, randomSig, sign
} from "../interface/abi";
import { Block, BlockHeader, Message, Confirmer, Signature, BlockBody } from "../interface/types";
import { MinEthersFactory } from "../typechain-types/common";

export async function randomBlockHeader(): Promise<BlockHeader> {
  return {
    prevBlockId: randomBytes32(),
    blockBodyId: randomBytes32(),
    timestamp: await time.latest(),
  }
}

export async function createWallets(count: number = 8) {
  const wallets: Wallet[] = [];
  for (let i = 0; i < count; i++) {
    wallets.push(await ethers.Wallet.createRandom());
  }
  return wallets;
}

export async function deployAbi() {
  const fchainAbiFactory = await ethers.getContractFactory("FirmChainAbi");
  let abiLib;
  expect(abiLib = await fchainAbiFactory.deploy()).to.not.be.reverted;
  
  const signers = await ethers.getSigners();

  return { signers, abiLib };
}

export async function deployAbiProxy() {

  const { signers, abiLib } = await loadFixture(deployAbi);

  const abiProxyFactory = await ethers.getContractFactory(
    "FirmChainAbiProxy",
    {
      libraries: {
        FirmChainAbi: abiLib.address
      },
    }
  );
  let abiProxy;
  expect(abiProxy = await abiProxyFactory.deploy()).to.not.be.reverted;

  return { abiLib, abiProxy, signers };

}

// Checks if encoding performed as expected by the frontend
describe("FirmChainAbi", function () {
  
  it("Should deploy FirmChainAbi", async function() {
    const fchainAbi = await loadFixture(deployAbiProxy);
  });

  it("Should encode a block header", async function() {
    const { abiLib, abiProxy } = await loadFixture(deployAbiProxy);

    const header = await randomBlockHeader();

    const packedHeader = encodeHeader(header);

    expect(await abiProxy.encode(header)).to.equal(packedHeader);
  });

  it("Should encode confirmer", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const conf: Confirmer = {
      addr: signers[0]!.address,
      weight: 1
    };

    const encoded = await encodeConfirmer(conf);

    expect(await abiProxy.encodeConfirmer(conf)).to.equal(encoded);
  });

  it("Should decode confirmer", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const conf: Confirmer = {
      addr: signers[1]!.address,
      weight: 2
    };

    const encoded = await abiProxy.encodeConfirmer(conf);

    const decConf: Confirmer = await abiProxy.decodeConfirmer(encoded);

    expect(decConf).to.containSubset(conf);
  });

  it("Should compute block id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const header = await randomBlockHeader();
    const expectedId = getBlockId(header);

    expect(await abiProxy.getBlockId(header)).to.equal(expectedId);
  });

  it("Should compute confirmer set id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const confs: Confirmer[] = [
      {
        addr: signers[0]!.address,
        weight: 2
      },
      {
        addr: signers[1]!.address,
        weight: 3
      },
      {
        addr: signers[2]!.address,
        weight: 1
      },
    ];
    const threshold: number = 4;
    const expectedId = await getConfirmerSetId(confs, threshold);

    const id = await abiProxy.getConfirmerSetId(confs, threshold);

    expect(id).to.equal(expectedId);
  });

  it("Should encode block body", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const msgs: Message[] = [
      {
        addr: signers[3]!.address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4]!.address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5]!.address,
        cdata: utils.randomBytes(32)
      }
    ];

    const body: BlockBody = {
      confirmerSetId: randomBytes32(),
      msgs,
    };

    const expected = encodeBlockBody(body);

    const encoded = await abiProxy.encodeBlockBody({ ...body, header: await randomBlockHeader() });

    expect(encoded).to.equal(expected);
  });

  it("Should get block body id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const msgs: Message[] = [
      {
        addr: signers[3]!.address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4]!.address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5]!.address,
        cdata: utils.randomBytes(32)
      }
    ];

    const body: BlockBody = {
      confirmerSetId: randomBytes32(),
      msgs,
    };

    const block: Block = {
      ...body,
      header: await randomBlockHeader(),
    };

    const encoded = await abiProxy.encodeBlockBody(block);

    expect(await abiProxy.getBlockBodyId(block)).to.equal(utils.keccak256(encoded));
  });


  it("Should verify block body id to be correct", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const msgs: Message[] = [
      {
        addr: signers[3]!.address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4]!.address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5]!.address,
        cdata: utils.randomBytes(32)
      }
    ];

    const body: BlockBody = {
      confirmerSetId: randomBytes32(),
      msgs,
    };

    const block: Block = {
      ...body,
      header: await randomBlockHeader(),
    };

    const expectedId = getBlockBodyId(block); 
    block.header.blockBodyId = expectedId;

    expect(await abiProxy.verifyBlockBodyId(block)).to.be.true;
  });

  it("Should verify block body id to be incorrect", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const msgs: Message[] = [
      {
        addr: signers[3]!.address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4]!.address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5]!.address,
        cdata: utils.randomBytes(32)
      }
    ];

    const body: BlockBody = {
      confirmerSetId: randomBytes32(),
      msgs,
    };

    const block: Block = {
      ...body,
      header: await randomBlockHeader(),
    };

    expect(await abiProxy.verifyBlockBodyId(block)).to.be.false;
  });

  it("Should compute block digest", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const header = await randomBlockHeader();
    const expected = getBlockDigest(header);

    expect(await abiProxy.getBlockDigest(header)).to.equal(expected); 
  });

  it("Should verify that block signature is invalid", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbiProxy);

    const header = await randomBlockHeader();

    const sig = randomSig();

    expect(await abiProxy.verifyBlockSig(header, sig, signers[0]!.address)).to.be.false;
    expect(await abiProxy.verifyBlockSig(header, sig, signers[1]!.address)).to.be.false;
  });

  it("Should verify that block signature is valid", async function() {
    const { abiProxy } = await loadFixture(deployAbiProxy);
    const wallets = await createWallets();

    const header = await randomBlockHeader();
    const digest = getBlockDigest(header);

    const sig = wallets[0]!._signingKey().signDigest(digest);

    expect(await abiProxy.verifyBlockSig(header, sig, wallets[0]!.address)).to.be.true;

    const sig2 = await sign(wallets[1]!, header);
    expect(await abiProxy.verifyBlockSig(header, sig2, wallets[1]!.address)).to.be.true;
  });

});