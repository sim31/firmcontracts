import {
  ConfirmerStruct,
  ConfirmerStructOutput,
  BlockStruct,
  BlockStructOutput,
  BlockHeaderStruct,
  BlockHeaderStructOutput,
  MessageStruct,
  SignatureStruct
} from "../typechain-types/FirmChainAbi";
import { ethers } from "ethers";
import { ConfirmerOpStruct } from "../typechain-types/FirmChain";

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
