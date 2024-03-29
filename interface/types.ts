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
import { ethers, Wallet, BytesLike, } from "ethers";
import { ConfirmerOpStruct, } from "../typechain-types/contracts/FirmChain";
import { EdenPlusFractal } from '../typechain-types/contracts/EdenPlusFractal';
import { Optional, Overwrite, ValuesType } from "utility-types";
import { PromiseOrValue } from "../typechain-types/common";
import { AccountStruct } from "../typechain-types/contracts/AccountSystem";

export * from "../typechain-types";

export type AddressStr = string;
export type BlockIdStr = string;
export type IPFSLink = string;

// TODO: Export typechain types

export type Unpromised<T> = {
  [P in keyof T]:
    T[P] extends object ?
      (
        T[P] extends Array<infer V> ?
        Array<Unpromised<V>> :
        Unpromised<T[P]>
      )
    : undefined extends T[P] ?
      Unpromised<Required<T[P]>> | undefined :
      Awaited<T[P]>
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
export type BreakoutResults = EdenPlusFractal.BreakoutResultsStruct;
export type BlockBody = {
  confirmerSetId: PromiseOrValue<BytesLike>;
  msgs: MessageStruct[];
}

export type ConfirmerOutput = ConfirmerStructOutput;

export type ConfirmerValue = 
  Overwrite<Unpromised<ConfirmerStruct>, { weight: number }>;

export type AccountValue = Unpromised<AccountStruct>;

export type BlockValue = Unpromised<Block>;
export type BlockHeaderValue = Unpromised<BlockHeader>;
export type MessageValue = Unpromised<Message>;
export type SignatureValue = Unpromised<Signature>
export type ConfirmerOpValue = 
  Overwrite<Unpromised<ConfirmerOp>, { conf: ConfirmerValue }>;
export type BlockBodyValue = Unpromised<BlockBody>;

export const ZeroId = ethers.constants.HashZero;
export const ZeroAddr = ethers.constants.AddressZero;

export const ConfirmerOpId = {
  Add: 0,
  Remove: 1
} as const;

export const ConfirmerStatus = {
  Faulty: 3,
} as const;

export function isBlock(bl: BlockHeader | Block | ExtendedBlock): bl is Block {
  return 'header' in bl;
}

export function isConfirmer(conf: Confirmer | any): conf is Confirmer {
  return typeof conf === 'object' && 'addr' in conf && 'weight' in conf;
}

export function isWallet(w: Wallet | any): w is Wallet {
  return typeof w === 'object' && 'address' in w && 'provider' in w;
}

export function isWallets(w: Wallet[] | any): w is Wallet[] {
  return isWallet(w[0]);
}

export interface ConfirmerSet {
  threshold: number,
  confirmers: ConfirmerValue[],
}
export const InitConfirmerSet: ConfirmerSet = {
  threshold: 0,
  confirmers: [],
};

export interface Account {
  address: AddressStr;
  name?: string;
  ipnsAddress?: string;
}

export interface ChainState {
  blockId: string,
  confirmerSet: ConfirmerSet;
  blockNum: number;
  directory?: IPFSLink;
  name?: string,
  accounts?: Record<AddressStr, Account>;
  confirmCount?: number,
  totalWeight?: number
  // Threshold needed to finalize this block 
  // (confirmerSet has threshold set to finalize the next block)
  thresholdThis?: number, 
}

export type ExtendedBlock = Block & {
  state: ChainState,
  contract: IFirmChain,
  signers: Wallet[],
  signatures: SignatureStruct[],
}

export type UnsignedBlock = Optional<ExtendedBlock, 'signers' | 'signatures'>;
export type NoContractBlock = Optional<ExtendedBlock, 'contract'>;
export type OptExtendedBlock = Optional<ExtendedBlock, 'signers' | 'contract' | 'signatures'>;
export type GenesisBlock = OptExtendedBlock;
type Val = Unpromised<OptExtendedBlock>;

export type ExtendedBlockValue = 
  Overwrite<Unpromised<ExtendedBlock>, { contract: AddressStr, signers: AddressStr[] }>;
export type UnsignedBlockValue = Optional<ExtendedBlockValue, 'signers'>;
export type NoContractBlockValue = Optional<ExtendedBlockValue, 'contract'>;
export type OptExtendedBlockValue = Optional<ExtendedBlockValue, 'contract' | 'signers' | 'signatures'>;
export type GenesisBlockValue = OptExtendedBlockValue;

// export async function arrayToValue<T extends Array<infer V>>(promisedArr: T): Promise<Unpromised<T>> {
//   const arr: [];
//   for (const element of promisedArr) {
//     if (Array.isArray(element)) {
//       arr.push(await arrayToValue(element));
//     }
//     if (typeof element === 'object' && element !== null)    
//   }
// }
export async function toValue<T extends {}>(
  promisedStruct: T,
): Promise<Unpromised<T>> {
  if (Array.isArray(promisedStruct)) {
    const arr: any[] = [];
    for (const val of promisedStruct) {
      if (typeof val === 'object' && val !== null) {
        arr.push(await toValue(val));
      } else {
        arr.push(await Promise.resolve(val));
      }
    }
    return arr as Unpromised<T>;
  }
  else {
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
}
