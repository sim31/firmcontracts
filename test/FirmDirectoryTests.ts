import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize, deployToken } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet } from "ethers";
import { FirmDirectory, FirmChainImpl } from "../typechain-types";
import { ConfirmerOpValue, ExtendedBlock, ZeroId } from "../interface/types";
import { createAddConfirmerOp, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";
import { randomBytes32Hex } from "../interface/abi";
import { FirmContractDeployer } from "../interface/deployer";

export type FirmDirectoryInfo = Overwrite<ChainInfo, { chain: FirmDirectory }>;

const deployer = new FirmContractDeployer(ethers.provider);

async function deployFs() {
  await deployer.init();
  return await deployer.deployFilesystem();
}

export async function deployFirmDirectory(
  confirmers: Wallet[] | ChainInfo[],
  threshold: number,
  implLib: FirmChainImpl,
): Promise<FirmDirectoryInfo> {
  const factory = await ethers.getContractFactory(
    "FirmDirectory",
    {
      libraries: { FirmChainImpl: implLib.address }
    }
  );

  const confOps: ConfirmerOpValue[] = confirmers.map((conf) => {
    return createAddConfirmerOp(conf, 1);
  });
  const genesisBlock = await createGenesisBlock([], ZeroId, confOps, threshold);

  const deployCall = factory.deploy(genesisBlock, confOps, threshold);
  await expect(deployCall).to.not.be.reverted;
  const chain = await deployCall;
  const genesisBl: ExtendedBlock = {
    ...genesisBlock,
    contract: chain,
    signers: [],
    signatures: [],
  };

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

async function deploy2ndOrderFirmDir() {
  const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
  const fsContract = await deployFs();

  const wallets = await abi.createWallets(16);

  const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
  const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
  const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

  const ord2Chain = await deployFirmDirectory([
    chain1,
    chain2,
    chain3,
  ], 2, implLib);

  return {
    chain1, chain2, chain3,
    ord2Chain,
    abiLib, signers,
    wallets,
    fsContract
  };
}


describe("FirmDirectory", function() {
  describe("Deployment", async function() {
    it("Should deploy FirmDirectory chain successfully", async () => {
      await loadFixture(deploy2ndOrderFirmDir);
    });
  });

  describe("setDir", async function() {
    it("Should have directoryId as 0 after deployment", async function() {
      const chains = await loadFixture(deploy2ndOrderFirmDir);
      
      expect(await chains.ord2Chain.chain.getDir()).to.equal(ZeroId);
    });

    it("Should not allow setting dir for external accounts", async function() {
      const { ord2Chain } = await loadFixture(deploy2ndOrderFirmDir);

      await expect(ord2Chain.chain.setDir(randomBytes32Hex())).to.be.revertedWith( "Can only be called by self");
    });

    it("Should not allow setting dir from other smart contracts", async function() {
      const { ord2Chain, chain1, wallets } = await loadFixture(deploy2ndOrderFirmDir);

      const token = await deployToken(chain1.chain.address);

      // Test if chain can issue other actions
      let newChain1 = await createBlockAndExecute(
        chain1,
        [createMsg(token, 'mint', [wallets[0]!.address, 10])],
        chain1.confirmers,
      );
      expect(await token.balanceOf(wallets[0]!.address)).to.equal(10);

      // Try setting dir of ord2Chain from chain1's call
      newChain1 = await createBlockAndFinalize(
        newChain1,
        [createMsg(ord2Chain.chain, 'setDir', [randomBytes32Hex()])],
        chain1.confirmers,
      );
      await expect(newChain1.chain.execute(newChain1.lastFinalized)).to.emit(
        chain1.chain, 'ExternalCallFail'
      );
      expect(await ord2Chain.chain.getDir()).to.equal(ZeroId);
    });

    it("Should allow FirmChain to set its own directory", async function() {
      const { ord2Chain } = await loadFixture(deploy2ndOrderFirmDir);

      const dirId = randomBytes32Hex();
      let newOrd2Chain = await createBlockAndFinalize(
        ord2Chain,
        [createMsg(ord2Chain.chain, 'setDir', [dirId])],
        ord2Chain.confirmers,
      );
      await expect(newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized)).to.emit(newOrd2Chain.chain, 'ExternalCall');

      expect(await ord2Chain.chain.getDir()).to.equal(dirId);
    });

    it("Should emit SetRoot event when directory is set", async function() {
      const { ord2Chain, fsContract } = await loadFixture(deploy2ndOrderFirmDir);

      const dirId = randomBytes32Hex();
      let newOrd2Chain = await createBlockAndFinalize(
        ord2Chain,
        [createMsg(ord2Chain.chain, 'setDir', [dirId])],
        ord2Chain.confirmers,
      );
      await expect(newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized))
        .to.emit(newOrd2Chain.chain, 'ExternalCall')
        .and.to.emit(fsContract, 'SetRoot')
        .withArgs(newOrd2Chain.chain.address, dirId);
    });
  })
});