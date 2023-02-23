import {
  Confirmer, ConfirmerOp, ConfirmerOpId, ExtendedBlock, isConfirmer, Message, SignedBlock,
  Block, BlockHeader, ConfirmerSet, InitConfirmerSet, ZeroId, FullExtendedBlock,
} from './types'
import { Wallet, BaseContract } from 'ethers';
import { normalizeHexStr, getBlockBodyId, getBlockId, sign, getConfirmerSetId, } from './abi';
import { IFirmChain } from '../typechain-types';

export function createAddConfirmerOps(confs: Confirmer[]): ConfirmerOp[] {
  return confs.map(conf => { return {opId:  ConfirmerOpId.Add, conf} });
}

export function createConfirmer(confWallet: Wallet, weight: number): Confirmer {
  return {
    addr: normalizeHexStr(confWallet.address), weight,
  };
}

export function createAddConfirmerOp(confWallet: Wallet, weight: number): ConfirmerOp;
export function createAddConfirmerOp(confirmer: Confirmer): ConfirmerOp;
export function createAddConfirmerOp(confirmer: Confirmer | Wallet, weight?: number) {
  const conf = isConfirmer(confirmer) ? confirmer : createConfirmer(confirmer, weight ?? 0); 
  const op: ConfirmerOp = {
    opId: ConfirmerOpId.Add,
    conf,
  };
  return op;
}

export function createRemoveConfirmerOp(confWallet: Wallet, weight: number): ConfirmerOp;
export function createRemoveConfirmerOp(confirmer: Confirmer): ConfirmerOp;
export function createRemoveConfirmerOp(confirmer: Wallet | Confirmer, weight?: number) {
  const conf = isConfirmer(confirmer) ? confirmer : createConfirmer(confirmer, weight ?? 0); 
  const op: ConfirmerOp = {
    opId: ConfirmerOpId.Remove,
    conf,
  };
  return op;
}

export function createMsg<
    T extends BaseContract,
    FunctionName extends keyof Pick<T['populateTransaction'], string>,
>(
  contract: T,
  functionName: FunctionName,
  args: Parameters<T['populateTransaction'][FunctionName]>,
) {
  const data = contract.interface.encodeFunctionData(functionName, args);
  const msg: Message = {
    addr: contract.address,
    cdata: data,
  };

  return msg;
}

export function updatedConfirmerSet(
  confirmerSet: Readonly<ConfirmerSet>,
  confirmerOps?: Readonly<ConfirmerOp[]>,
  newThreshold?: number,
): ConfirmerSet {
  // Update a list of confirmers
  let confs = confirmerSet.confirmers;
  if (confirmerOps) {
    confs = [...confirmerSet.confirmers];
    for (const op of confirmerOps) {
      if (op.opId === ConfirmerOpId.Add) {
        confs.push(op.conf);
      } else if (op.opId === ConfirmerOpId.Remove) {
        const toDeleteIndex = confs.findIndex(conf => conf.addr === op.conf.addr && conf.weight === op.conf.weight);
        if (toDeleteIndex === -1) {
          throw Error("Trying to remove a non existing confirmer");
        }
        // We have to delete the same way as in contract in order that confirmerSetId is preserved
        // Enumerable set uses 'swap and pop' to remove elements
        const lastIndex = confs.length - 1;
        if (lastIndex !== toDeleteIndex) {
          const lastConf = confs[lastIndex];
          confs[toDeleteIndex] = lastConf;
        }
        confs.pop();
      }
    }
  }
  const threshold = newThreshold ? newThreshold : confirmerSet.threshold;

  return {
    confirmers: confs,
    threshold,
  };
}

// IMPORTANT: Pass confirmer updates through confirmerOps instead of through messages
export async function createBlock(
  prevBlock: Required<ExtendedBlock>,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<FullExtendedBlock> {
  const prevHeader = prevBlock.header;

  const confSet = updatedConfirmerSet(prevBlock.confirmerSet, confirmerOps, newThreshold);
  if (newThreshold || confirmerOps) {
    messages.push(
      createMsg(prevBlock.contract, 'updateConfirmerSet', [confirmerOps ?? [], confSet.threshold])
    );
  }

  let newHeader: BlockHeader = {
    prevBlockId: getBlockId(prevHeader),
    blockBodyId: getBlockBodyId(messages),
    confirmerSetId: await getConfirmerSetId(confSet.confirmers, confSet.threshold),
    // TODO: Set current time
    timestamp: 0,
    sigs: []
  }
  newHeader = await sign(signers, newHeader);

  return {
    contract: prevBlock.contract,
    header: newHeader,
    msgs: messages,
    signers,
    confirmerSet: confSet,
  };
}

export async function createGenesisBlock(
  messages: Message[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<ExtendedBlock> {
  const confSet = updatedConfirmerSet(InitConfirmerSet, confirmerOps, newThreshold);

  let newHeader: BlockHeader = {
    prevBlockId: ZeroId,
    blockBodyId: getBlockBodyId(messages),
    confirmerSetId: await getConfirmerSetId(confSet.confirmers, confSet.threshold),
    // TODO: Set current time
    timestamp: 0,
    sigs: []
  }

  return {
    header: newHeader,
    msgs: messages,
    signers: [],
    confirmerSet: confSet,
  };
}

export async function createBlockTemplate(prevBlock: FullExtendedBlock) {
  return createBlock(prevBlock, [], []);
}
