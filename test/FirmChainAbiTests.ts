import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import chai, { expect } from "chai";
import chaiSubset from "chai-subset";
import { ethers } from "hardhat";

// import { FirmChain } from "../typechain-types/FirmChain";
import {
  ConfirmerStruct,
  ConfirmerStructOutput,
  BlockStruct,
  BlockStructOutput,
  BlockHeaderStruct,
  BlockHeaderStructOutput,
  CallStruct,
  SignatureStruct
} from "../typechain-types/contracts/FirmChainAbi";
import { BytesLike, BigNumberish, utils } from "ethers";
import { MinEthersFactory, PromiseOrValue } from "../typechain-types/common";
import { EthGasReporterConfig } from "hardhat-gas-reporter/dist/src/types";

chai.use(chaiSubset);

type Confirmer = ConfirmerStruct;
type Block = BlockStruct;
type BlockHeader = BlockHeaderStruct;
type Call = CallStruct;
type Signature = SignatureStruct;

export function encodeBlockBody(calls: readonly Call[]): BytesLike {
  const coder = utils.defaultAbiCoder;
  return coder.encode(["tuple(address addr, bytes cdata)[]"], [calls]);
}

export function getBlockBodyId(block: Block): string {
  const encBody = encodeBlockBody(block.calls);
  return utils.keccak256(encBody);
}

export async function encodeConfirmer(conf: Confirmer): Promise<BytesLike> {
  const bytes = utils.hexConcat(
    [utils.zeroPad("0x00", 11),
    await Promise.resolve(conf.addr),
    [Number((await Promise.resolve(conf.weight)).toString())]
  ]);
  expect(bytes.length).to.equal(66);
  return bytes;
}

export async function getConfirmerSetId(confs: Confirmer[], threshold: number): Promise<string> {
  let packedConfs: BytesLike[] = [];
  for (const c of confs) {
    packedConfs.push(await encodeConfirmer(c));
  }
  return utils.solidityKeccak256(["uint8", "bytes32[]"], [threshold, packedConfs]);
}

export function randomBytes32() {
  return utils.randomBytes(32);
}

export function randomBytes32Hex(): string {
  return utils.hexlify(randomBytes32());
}

export function randomBytesHex(n: number): string {
  return utils.hexlify(utils.randomBytes(n));
}

export function randomSig() {
  return utils.randomBytes(72);
}

export async function packSig(sig: Signature): Promise<BytesLike> {
  const v = await Promise.resolve(sig.v);
  return utils.concat([await Promise.resolve(sig.r), await Promise.resolve(sig.s), utils.hexlify(v)]);
}

export async function setBlockSignatures(header: BlockHeader, sigs: Signature[]): Promise<void> {
  let packedSigs: BytesLike[] = [];
  for (const sig of sigs) {
    packedSigs.push(await packSig(sig));
  }
  header.sigs = utils.concat(packedSigs);
}

export async function randomBlockHeaderSig1(): Promise<BlockHeader> {
  return {
    prevBlockId: randomBytes32(),
    blockBodyId: randomBytes32(),
    confirmerSetId: randomBytes32(),
    timestamp: await time.latest(),
    sigs: randomSig()
  }
}

export async function randomBlockHeaderSig3(): Promise<BlockHeader> {
  return {
    prevBlockId: randomBytes32(),
    blockBodyId: randomBytes32(),
    confirmerSetId: randomBytes32(),
    timestamp: await time.latest(),
    sigs: utils.concat([randomSig(), randomSig(), randomSig()])
  }
}

// TODO: This might not work if you pass promises as values in header
export function encodeHeader(header: BlockHeader) {
  return utils.solidityPack(
    ["bytes32", "bytes32", "bytes32", "uint", "bytes"],
    [
      header.prevBlockId,
      header.blockBodyId,
      header.confirmerSetId,
      header.timestamp,
      header.sigs
    ]
  );
}

// TODO: This might not work if you pass promises as values in header
export function getBlockDigest(header: BlockHeader): string {
  const encoded = utils.solidityPack(
    ["bytes32", "bytes32", "bytes32", "uint"],
    [
      header.prevBlockId,
      header.blockBodyId,
      header.confirmerSetId,
      header.timestamp
    ]
  );

  return utils.keccak256(encoded);
}

export function getBlockId(header: BlockHeader) {
  return utils.keccak256(encodeHeader(header));
}

export async function deployAbi() {
  const fchainAbiFactory = await ethers.getContractFactory("FirmChainAbi");
  let abiLib;
  expect(abiLib = await fchainAbiFactory.deploy()).to.not.be.reverted;
  
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

  const signers = await ethers.getSigners();

  return { abiLib, abiProxy, signers };
}

// Checks if encoding performed as expected by the frontend
export default describe("FirmChainAbi", function () {
  
  it("Should deploy FirmChainAbi", async function() {
    const fchainAbi = await loadFixture(deployAbi);
  });

  it("Should encode a block header without sigs", async function() {
    const { abiLib, abiProxy } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig1();
    header.sigs = [];

    const packedHeader = encodeHeader(header);

    expect(await abiProxy.encode(header)).to.equal(packedHeader);
  });

  it("Should encode a block header with sig", async function() {
    const { abiLib, abiProxy } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig1();

    const packedHeader = encodeHeader(header);

    expect(await abiProxy.encode(header)).to.equal(packedHeader);
  });

  it("Should encode a block header with sig", async function() {
    const { abiLib, abiProxy } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig3();

    const packedHeader = encodeHeader(header);

    expect(await abiProxy.encode(header)).to.equal(packedHeader);
  });

  it("Should encode confirmer", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const conf: Confirmer = {
      addr: signers[0].address,
      weight: 1
    };

    const encoded = await encodeConfirmer(conf);

    expect(await abiProxy.encodeConfirmer(conf)).to.equal(encoded);
  });

  it("Should decode confirmer", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const conf: Confirmer = {
      addr: signers[1].address,
      weight: 2
    };

    const encoded = await abiProxy.encodeConfirmer(conf);

    const decConf: Confirmer = await abiProxy.decodeConfirmer(encoded);

    expect(decConf).to.containSubset(conf);
  });

  it("Should compute block id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig3();
    const expectedId = getBlockId(header);

    expect(await abiProxy.getBlockId(header)).to.equal(expectedId);
  });

  it("Should compute confirmer set id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const confs: Confirmer[] = [
      {
        addr: signers[0].address,
        weight: 2
      },
      {
        addr: signers[1].address,
        weight: 3
      },
      {
        addr: signers[2].address,
        weight: 1
      },
    ];
    const threshold: number = 4;
    const expectedId = await getConfirmerSetId(confs, threshold);

    const id = await abiProxy.getConfirmerSetId(confs, threshold);

    expect(id).to.equal(expectedId);
  });

  it("Should encode block body", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const calls: Call[] = [
      {
        addr: signers[3].address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4].address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5].address,
        cdata: utils.randomBytes(32)
      }
    ];

    const expected = encodeBlockBody(calls);

    const encoded = await abiProxy.encodeBlockBody(calls);

    expect(encoded).to.equal(expected);
  });

  it("Should get block body id", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const calls: Call[] = [
      {
        addr: signers[3].address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4].address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5].address,
        cdata: utils.randomBytes(32)
      }
    ];

    const block: Block = {
      header: await randomBlockHeaderSig1(),
      calls
    };

    const encoded = await abiProxy.encodeBlockBody(calls);

    expect(await abiProxy.getBlockBodyId(block)).to.equal(utils.keccak256(encoded));
  });


  it("Should verify block body id to be correct", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const calls: Call[] = [
      {
        addr: signers[3].address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4].address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5].address,
        cdata: utils.randomBytes(32)
      }
    ];

    const block: Block = {
      header: await randomBlockHeaderSig1(),
      calls
    };

    const expectedId = getBlockBodyId(block); 
    block.header.blockBodyId = expectedId;

    expect(await abiProxy.verifyBlockBodyId(block)).to.be.true;
  });

  it("Should verify block body id to be incorrect", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const calls: Call[] = [
      {
        addr: signers[3].address,
        cdata: utils.randomBytes(2)
      },
      {
        addr: signers[4].address,
        cdata: utils.randomBytes(4)
      },
      {
        addr: signers[5].address,
        cdata: utils.randomBytes(32)
      }
    ];

    const block: Block = {
      header: await randomBlockHeaderSig1(),
      calls
    };

    expect(await abiProxy.verifyBlockBodyId(block)).to.be.false;
  });

  it("Should compute block digest", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig1();
    const expected = getBlockDigest(header);

    expect(await abiProxy.getBlockDigest(header)).to.equal(expected); 
  });

  it("Should get the right sig", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig1();
    const sig: Signature = { r: randomBytes32Hex(), s: randomBytes32Hex(), v: 8 };
    const otherSig: Signature = { r: randomBytes32(), s: randomBytes32(), v: 7 };
    await setBlockSignatures(
      header,
      [otherSig, sig, otherSig, otherSig]
    );

    expect(await abiProxy.getSig(header, 1)).to.containSubset(sig);

    await setBlockSignatures(
      header,
      [sig, otherSig, otherSig, otherSig]
    );
    expect(await abiProxy.getSig(header, 0)).to.containSubset(sig);

    await setBlockSignatures(
      header,
      [otherSig, otherSig, otherSig, sig]
    );
    expect(await abiProxy.getSig(header, 3)).to.containSubset(sig);
  });

  it("Should revert on attempt to get non-existent sig", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig3();

    await expect(abiProxy.getSig(header, 3)).to.be.revertedWith("sigIndex too big"); 
  });

  it("Should verify that block signature is invalid", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig3();

    expect(await abiProxy.verifySigInBlock(header, 0, signers[0].address)).to.be.false;
    expect(await abiProxy.verifySigInBlock(header, 2, signers[1].address)).to.be.false;
  });

  it("Should verify that block signature is valid", async function() {
    const { abiLib, abiProxy, signers } = await loadFixture(deployAbi);

    const header = await randomBlockHeaderSig1();
    const digest = getBlockDigest(header);

    const wallet = ethers.Wallet.createRandom();
    const sig = wallet._signingKey().signDigest(digest);
    const otherSig: Signature = { r: randomBytes32(), s: randomBytes32(), v: 7 };
    await setBlockSignatures(header, [sig, otherSig, otherSig]);

    expect(await abiProxy.verifySigInBlock(header, 0, wallet.address)).to.be.true;

    await setBlockSignatures(header, [otherSig, otherSig, sig]);
    expect(await abiProxy.verifySigInBlock(header, 2, wallet.address)).to.be.true;
  });

});