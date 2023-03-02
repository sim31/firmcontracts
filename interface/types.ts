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
import { Optional, Overwrite, ValuesType } from "utility-types";
import { string } from "hardhat/internal/core/params/argumentTypes";
import { PromiseOrValue } from "../typechain-types/common";

export * from "../typechain-types";

export type AddressStr = string;

// TODO: Export typechain types

export type Unpromised<T> = {
  [P in keyof T]:
    T[P] extends object ?
      T[P] extends Array<infer V> ?
        Array<Unpromised<V>> :
      Unpromised<T[P]> :
    Awaited<T[P]>;
}

// 
// export type UnpromisedDeep1<T> = {
//   [P in keyof T]:
//     T[P] extends Array<any> ?
//       Array<Unpromised<ValuesType<T[P]>>> : Unpromised<T[P]>;
// }

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

export type ExtendedBlockValue = Unpromised<ExtendedBlock>;
export type UnsignedBlockValue = Unpromised<UnsignedBlock>;
export type NoContractBlockValue = Unpromised<NoContractBlock>;
export type GenesisBlockValue = Unpromised<GenesisBlock>;

export async function toValue<T extends {}>(promisedStruct: T): Promise<Unpromised<T>> {
  const obj: Record<string, unknown> = {};
  const entries = Object.entries(promisedStruct);
  for (const [key, val] of entries) {
    if (typeof val === 'object' && val !== null) {
      obj[key] = await toValue(val);
    } else {
      obj[key] = await Promise.resolve(val);        
    }
  }
  return obj as Unpromised<T>;
}
