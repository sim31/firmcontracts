import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

import { FirmChain } from "../typechain-types/FirmChain";
import {
  CommandStruct,
  ConfirmerStruct,
  CommandStructOutput,
  ConfirmerStructOutput,
  BlockStruct,
  BlockHeaderStruct
} from "../typechain-types/FirmChainAbi";
import { BytesLike, BigNumberish, utils } from "ethers";

type Confirmer = ConfirmerStruct;
type Command = CommandStruct;
type Block = BlockStruct;
type BlockHeader = BlockHeaderStruct;

describe("FirmChain", function () {

  // TODO: Move to separate module
  const CommandIdMax = 255;
  const CommandIds = {
    AddConfirmer: CommandIdMax,
    RemoveConfirmer: CommandIdMax - 1,
    SetConfThreshold: CommandIdMax - 2
  } as const;

  function packConfirmer(addr: string, weight: number): BytesLike {
    const bytes = utils.hexConcat([utils.zeroPad("0x00", 11), addr, [weight]]);
    expect(bytes.length).to.equal(66);
    return bytes;
  }

  function addConfirmerCmd(packedConfirmer: BytesLike): Command {
    return {
      cmdId: CommandIds.AddConfirmer,
      cmdData: packedConfirmer
    }
  }

  async function deployAbi() {
    const fchainAbiFactory = await ethers.getContractFactory("FirmChainAbi");
    const fchainAbi = fchainAbiFactory.deploy();
    expect(await fchainAbi).to.not.be.reverted;
    return fchainAbi;
  }

  async function createGenesisBlock() {
    const fchainAbi = await loadFixture(deployAbi);

    // Contracts are deployed using the first signer/account by default
    const signers = await ethers.getSigners();
    const [acc1, acc2, acc3, acc4, acc5] = signers;
    console.log(`Accounts:\n ${acc1.address}\n${acc2.address}\n${acc3.address}\n${acc4.address}`);

    const factory = await ethers.getContractFactory("FirmChain", {
      libraries: {
        FirmChainAbi: fchainAbi.address
      }
    });

    const packedConfirmers = [
      packConfirmer(acc1.address, 1),
      packConfirmer(acc2.address, 1),
      packConfirmer(acc3.address, 1),
      packConfirmer(acc4.address, 1),
    ];

    const conf1Cmd = addConfirmerCmd(packedConfirmers[0]);
    const conf2Cmd = addConfirmerCmd(packedConfirmers[1]);
    const conf3Cmd = addConfirmerCmd(packedConfirmers[2]);
    const conf4Cmd = addConfirmerCmd(packedConfirmers[3]);

    const thresholdCmd: Command = {
      cmdId: CommandIds.SetConfThreshold,
      cmdData: "0x03"
    }

    const confSetId = utils.solidityKeccak256(["uint8", "bytes32[]"], ["0x03", packedConfirmers]);

    const abiCoder = utils.defaultAbiCoder;

    const blockData = abiCoder.encode(["tuple(uint8 cmdId, bytes cmdData)[]"],
      [[conf1Cmd, conf2Cmd, conf3Cmd, conf4Cmd, thresholdCmd]]);
    // const blockData = "0x" + abi.encodeFunctionData("encodeCmds", [[conf1Cmd, conf2Cmd, conf3Cmd, conf4Cmd, thresholdCmd]]).slice(2 * 6);
    console.log(`blockData: ${blockData}`);
    
    const encBody = abiCoder.encode([
      "bytes32",
      "tuple(address code, bytes32 prevBlockId, bytes32 blockBodyId, uint timestamp, tuple(bytes32 r, bytes32 s, uint8 v)[])[]", "bytes"],
      [confSetId, [], blockData]);
    // const encBody = abi.encodeFunctionData("encodeBlockBody", [confSetId, [], blockData]);
    const bodyId = utils.keccak256(encBody);

    const header: BlockHeader = {
      code: ethers.constants.AddressZero,
      prevBlockId: ethers.constants.HashZero,
      blockBodyId: bodyId,
      timestamp: time.latest(),
      sigs: []
    };

    const block: Block = {
      header,
      confirmerSetId: confSetId,
      confirmedBl: [],
      blockData: blockData
    };

    return { block, signers, packedConfirmers, factory };

  }

  describe("Deployment", async function() {
    it("Should fail because of wrong confirmerSetId", async function() {
      const { block, signers, packedConfirmers, factory } = await loadFixture(createGenesisBlock);

      const goodId = block.confirmerSetId;
      block.confirmerSetId = utils.solidityKeccak256(["uint8"], ["0x03"]);

      await expect(factory.deploy(block, { gasLimit: 2552000 })).to.be.revertedWith(
        "Declared confirmer set does not match computed"
      );

      block.confirmerSetId = goodId;
    });

    it("Should deploy successfully", async function() {
      const { block, signers, packedConfirmers, factory } = await loadFixture(createGenesisBlock);

      await expect(factory.deploy(block, { gasLimit: 9552000 })).to.not.be.reverted;
    });

  })

});

