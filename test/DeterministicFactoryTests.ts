import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { BytesLike } from "ethers";
import * as detFactory from "@zoltu/deterministic-deployment-proxy/output/deployment.json";
import { ConfirmerOpValue, ZeroId } from "../interface/types";
import { getBlockId, normalizeHexStr } from "../interface/abi";
import { createWallets, randomBlockHeader } from "./FirmChainAbiTests";
import { createAddConfirmerOp, createGenesisBlock } from "../interface/firmchain";
import { FirmContractDeployer } from "../interface/deployer";

const deployer = new FirmContractDeployer(ethers.provider);

export async function detDeployAbi() {
  const detFactory = await loadFixture(deployer.init.bind(deployer));

  return (await deployer.deployAbi());

}

export async function detDeployAbiProxy() {
  const abi = await loadFixture(detDeployAbi);
  
  const factory = await ethers.getContractFactory(
    "FirmChainAbiProxy",
    {
      libraries: {
        FirmChainAbi: abi.address,
      },
    }
  );
  const bytecode = await factory.getDeployTransaction().data ?? "0x00";

  const proxyAddr = await deployer.detDeployContract(bytecode, 'abiProxy');

  const abiProxy = factory.attach(proxyAddr);

  return { abiProxy, abi };
}

export async function detDeployFirmChainImpl() {
  const abi = await loadFixture(detDeployAbi);

  const implLib = await deployer.deployFirmChainImpl(abi);

  return { implLib, abi };
}

export async function detDeployFirmChain() {
  const { implLib, abi } = await loadFixture(detDeployFirmChainImpl);
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
    createAddConfirmerOp(wallets[0]!, 1),
    createAddConfirmerOp(wallets[1]!, 1),
  ]
  const genesisBlock = await createGenesisBlock([], ZeroId, confOps, 1);

  const bytecode = factory.getDeployTransaction(genesisBlock, confOps, 1).data ?? "0x00";

  const addr = await deployer.detDeployContract(bytecode, 'firmchain');

  const chain = factory.attach(addr);

  return { abi, implLib, chain };
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