import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { BytesLike } from "ethers";
import * as detFactory from "@zoltu/deterministic-deployment-proxy/output/deployment.json";
import { ConfirmerOpValue, ZeroId } from "../interface/types";
import { getBlockId, normalizeHexStr } from "../interface/abi";
import { createWallets, randomBlockHeader } from "./FirmChainAbiTests";
import { createAddConfirmerOp, createGenesisBlock } from "../interface/firmchain";

export async function deployDetFactory() {
  const signers = await ethers.getSigners();
  const response = await signers[0].sendTransaction({
    to: "0x" + detFactory.signerAddress,
    value: "0x" + detFactory.gasPrice * detFactory.gasLimit,
  });
  const receipt = await response.wait();
  // console.log("receipt: ", receipt);
  // console.log("balance: ", await ethers.provider.getBalance("0x" + detFactory.signerAddress));
  
  const tx = await ethers.provider.sendTransaction(
    "0x" + detFactory.transaction
  );
  // console.log("ok");
  await tx.wait();
  return detFactory;
}

export async function detDeployContract(bytecode: BytesLike) {
  const addr = await ethers.provider.call({ to: detFactory.address, data: bytecode });

  const signers = await ethers.getSigners();
  const resp = await signers[0].sendTransaction({
    to: detFactory.address, data: bytecode
  });
  await resp.wait();

  expect(await ethers.provider.getCode(addr)).to.not.equal('0x');

  const initCodeHash = ethers.utils.keccak256(bytecode ?? '0x00');
  const expAddr = ethers.utils.getCreate2Address(detFactory.address, ZeroId, initCodeHash);

  expect(normalizeHexStr(addr)).to.equal(normalizeHexStr(expAddr));

  return addr;
}

export async function detDeployAbi() {
  const detFactory = await loadFixture(deployDetFactory);

  const factory = await ethers.getContractFactory("FirmChainAbi");
  const bytecode = await factory.getDeployTransaction().data;

  return await detDeployContract(bytecode ?? "0x00");
}

export async function detDeployAbiProxy() {
  const abiAddr = await loadFixture(detDeployAbi);
  
  const factory = await ethers.getContractFactory(
    "FirmChainAbiProxy",
    {
      libraries: {
        FirmChainAbi: abiAddr,
      },
    }
  );
  const bytecode = await factory.getDeployTransaction().data ?? "0x00";

  const proxyAddr = await detDeployContract(bytecode);

  const abiProxy = factory.attach(proxyAddr);

  return { abiProxy, abiAddr };
}

export async function detDeployFirmChainImpl() {
  const abiAddr = await loadFixture(detDeployAbi);

  const factory = await ethers.getContractFactory(
    "FirmChainImpl",
    {
      libraries: {
        FirmChainAbi: abiAddr,
      },
    },
  );

  const bytecode = await factory.getDeployTransaction().data ?? "0x00";

  const addr = await detDeployContract(bytecode);

  const implLib = factory.attach(addr);

  return { implLib, abiAddr };
}

export async function detDeployFirmChain() {
  const { implLib, abiAddr } = await loadFixture(detDeployFirmChainImpl);
  const wallets = await createWallets();

  const factory = await ethers.getContractFactory(
    "FirmChain",
    {
      libraries: {
        FirmChainImpl: implLib.address,
      },
    },
  );

  const confOps: ConfirmerOpValue[] = [
    createAddConfirmerOp(wallets[0], 1),
    createAddConfirmerOp(wallets[1], 1),
  ]
  const genesisBlock = await createGenesisBlock([], ZeroId, confOps, 1);

  const bytecode = factory.getDeployTransaction(genesisBlock, confOps, 1).data ?? "0x00";

  const addr = await detDeployContract(bytecode);

  const chain = factory.attach(addr);

  return { abiAddr, implLib, chain };
}

describe("DeterministicFactory", function() {
  it("Should deploy ABI at a known address", async function() {
    const { abiProxy } = await loadFixture(detDeployAbiProxy);

    const header = await randomBlockHeader();
    const expectedId = getBlockId(header);
    expect(await abiProxy.getBlockId(header)).to.equal(expectedId);
  });

  it("Should deploy firmchain at a known address", async function() {
    const { chain } = await loadFixture(detDeployFirmChain);

    expect(await chain.getThreshold()).to.be.equal(1);
  });
});