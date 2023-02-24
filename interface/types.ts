import {
  ConfirmerStruct,
  ConfirmerStructOutput,
  BlockStruct,
  BlockStructOutput,
  BlockHeaderStruct,
  BlockHeaderStructOutput,
  MessageStruct,
  SignatureStruct,
} from "../typechain-types/contracts/FirmChainAbi";
import { IFirmChain } from "../typechain-types/contracts/IFirmChain";
import { ethers, Wallet, BaseContract, } from "ethers";
import { ConfirmerOpStruct, } from "../typechain-types/contracts/FirmChain";
import { Optional, Overwrite } from "utility-types";

export * from "../typechain-types";

export type AddressStr = string;

// TODO: Export typechain types

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

export type ConfirmerValue = 
  Overwrite<Unpromised<ConfirmerStruct>, { weight: number }>;
export type BlockValue = Unpromised<Block>;
export type BlockHeaderValue = Unpromised<BlockHeader>;
export type MessageValue = Unpromised<Message>;
export type SignatureValue = Unpromised<Signature>
export type ConfirmerOpValue = Unpromised<ConfirmerOp>;

export const ZeroId = ethers.constants.HashZero;
export const ZeroAddr = ethers.constants.AddressZero;

export const ConfirmerOpId = {
  Add: 0,
  Remove: 1
} as const;

export function isBlock(bl: BlockHeader | Block): bl is Block {
  return 'header' in bl;
}

export function isConfirmer(conf: Confirmer | Wallet): conf is Confirmer {
  return 'addr' in conf && 'weight' in conf;
}

export interface ConfirmerSet {
  threshold: number,
  confirmers: Confirmer[],
}
export const InitConfirmerSet: ConfirmerSet = {
  threshold: 0,
  confirmers: [],
};

export type ExtendedBlock = Block & {
  confirmerSet: ConfirmerSet,
  contract: IFirmChain,
  signers: Wallet[],
}
export type UnsignedBlock = Optional<ExtendedBlock, 'signers'>;
export type NoContractBlock = Optional<ExtendedBlock, 'contract'>;
export type GenesisBlock = Optional<ExtendedBlock, 'signers' | 'contract'>;
