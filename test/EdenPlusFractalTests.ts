import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployImplLib, deployChain, createBlockAndExecute, createBlockAndFinalize } from "./FirmChainTests";
import type { ChainInfo } from "./FirmChainTests";
import * as abi from "./FirmChainAbiTests";
import { Wallet } from "ethers";
import { EdenPlusFractal, FirmChainImpl } from "../typechain-types";
import { ConfirmerOpValue, ExtendedBlock } from "../interface/types";
import { createAddConfirmerOp, createBlockTemplate, createGenesisBlock, createMsg } from "../interface/firmchain";
import { Overwrite } from "utility-types";

export type EFChainInfo = Overwrite<ChainInfo, { chain: EdenPlusFractal }>;

// export async function deployEFChain(
//   confirmers: Wallet[] | ChainInfo[],
//   threshold: number,
//   implLib: FirmChainImpl,
//   name: string,
//   symbol: string,
// ): Promise<EFChainInfo> {
//   const factory = await ethers.getContractFactory(
//     "EdenPlusFractal",
//     {
//       libraries: { FirmChainImpl: implLib.address }
//     }
//   );

//   const confOps: ConfirmerOpValue[] = confirmers.map((conf) => {
//     return createAddConfirmerOp(conf, 1);
//   });
//   const genesisBlock = await createGenesisBlock([], confOps, threshold);

//   const deployCall = factory.deploy(genesisBlock, confOps, threshold, name, symbol);
//   await expect(deployCall).to.not.be.reverted;
//   const chain = await deployCall;
//   const genesisBl: ExtendedBlock = {
//     ...genesisBlock,
//     contract: chain,
//     signers: [],
//   };

//   return {
//     confirmers,
//     chain,
//     nextHeader: (await createBlockTemplate(genesisBl)).header,
//     genesisBl: genesisBl,
//     confirmerValues: genesisBl.state.confirmerSet.confirmers,
//     threshold: genesisBl.state.confirmerSet.threshold,
//     headBlock: genesisBl,
//     lastFinalized: genesisBl,
//   };
// }

// async function deployEF() {
//   const { implLib, abiLib, signers } = await loadFixture(deployImplLib);
//   const wallets = await abi.createWallets(16);

//   const chain1 = await deployChain(wallets.slice(0, 4), 3, implLib);
//   const chain2 = await deployChain(wallets.slice(4, 8), 3, implLib);
//   const chain3 = await deployChain(wallets.slice(8, 12), 3, implLib);

//   const ord2Chain = await deployEFChain([
//     chain1,
//     chain2,
//     chain3,
//   ], 2, implLib, "SomeFractal", "SF");

//   return {
//     chain1, chain2, chain3,
//     ord2Chain,
//     abiLib, signers,
//     wallets,
//   };
// }

// describe("EdenPlusFractal", function() {
//   describe("Deployment", async function() {
//     it("Should deploy EdenPlusFractal chain successfully", async () => {
//       await loadFixture(deployEF);
//     });
//   });

//   const rewards: number[] = [2, 3, 5, 8, 13, 21];

//   describe("submitResults", async function() {
//     it("Should mint the right rewards", async function() {
//       const chains = await loadFixture(deployEF);
//       const { wallets, ord2Chain } = chains;
//       const addrs = wallets.map(w => w.address);

//       const msg = createMsg(
//         ord2Chain.chain,
//         'submitResults',
//         [[
//           {
//             delegate: addrs[0],
//             ranks: [
//               addrs[0],
//               addrs[1],
//               addrs[2],
//               addrs[3],
//               addrs[4],
//               addrs[5],
//             ]
//           },
//           {
//             delegate: addrs[6],
//             ranks: [
//               addrs[6],
//               addrs[7],
//               addrs[8],
//               addrs[9],
//               addrs[10],
//               addrs[11],
//             ]
//           }
//         ]]
//       );

//       let newOrd2Chain = await createBlockAndFinalize(
//         ord2Chain,
//         [msg],
//         ord2Chain.confirmers,
//       );            

//       await expect(
//         newOrd2Chain.chain.execute(newOrd2Chain.lastFinalized)
//       ).to.not.be.reverted;

//       expect(await newOrd2Chain.chain.)      
      
//     });

//   });
// });

