import {
  ConfirmerStruct,
  ConfirmerStructOutput,
  BlockStruct,
  BlockStructOutput,
  BlockHeaderStruct,
  BlockHeaderStructOutput,
  MessageStruct,
  SignatureStruct
} from "../typechain-types/contracts/FirmChainAbi";
import { ethers, Wallet } from "ethers";
import { ConfirmerOpStruct } from "../typechain-types/contracts/FirmChain";

export type Unpromised<T> = {
  [P in keyof T]: Awaited<T[P]>;
}

export type Confirmer = ConfirmerStruct;
export type Block = BlockStruct;
export type BlockHeader = BlockHeaderStruct;
export type Message = MessageStruct;
export type Signature = SignatureStruct;
export type ConfirmerOp = ConfirmerOpStruct;

export type ConfirmerOutput = ConfirmerStructOutput;

export type ConfirmerValue = Unpromised<ConfirmerStruct>;

export const ZeroId = ethers.constants.HashZero;
export const ZeroAddr = ethers.constants.AddressZero;

export const ConfirmerOpId = {
  Add: 0,
  Remove: 1
} as const;

export function isBlock(bl: BlockHeader | Block): bl is Block {
  return 'header' in bl;
}

export type SignedBlock = Block & { signers: Wallet[] };
