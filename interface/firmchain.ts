import {
  Confirmer, ConfirmerOp, ConfirmerOpId, ExtendedBlock, isConfirmer, Message,
  UnsignedBlock, BlockHeader, ConfirmerSet, InitConfirmerSet, ZeroId,
  GenesisBlock, NoContractBlock, ConfirmerValue,
} from './types'
import { Wallet, BaseContract } from 'ethers';
import { normalizeHexStr, getBlockBodyId, getBlockId, sign, getConfirmerSetId, decodeConfirmer, } from './abi';
import { FirmChain, IFirmChain } from '../typechain-types';
import { boolean } from 'hardhat/internal/core/params/argumentTypes';

export function createAddConfirmerOps(confs: Confirmer[]): ConfirmerOp[] {
  return confs.map(conf => { return {opId:  ConfirmerOpId.Add, conf} });
}

export function createConfirmer(confWallet: Wallet, weight: number): Confirmer {
  return {
    addr: normalizeHexStr(confWallet.address), weight,
  };
}

export function createAddConfirmerOp(confirmer: Wallet, weight: number): ConfirmerOp;
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
        const index = confs.findIndex(conf => conf.addr === op.conf.addr && conf.weight === op.conf.weight);
        if (index !== -1) {
          throw Error("Cannot add a confirmer which already exists");
        }
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

export async function createUnsignedBlock(
  prevBlock: ExtendedBlock,
  messages: Message[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<UnsignedBlock> {
  const prevHeader = prevBlock.header;

  let confSet = prevBlock.confirmerSet;
  try {
    confSet = updatedConfirmerSet(prevBlock.confirmerSet, confirmerOps, newThreshold);
  } catch(err) {
    if (!ignoreConfirmerSetFail) {
      throw err;
    }
  }

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

  return {
    contract: prevBlock.contract,
    header: newHeader,
    msgs: messages,
    confirmerSet: confSet,
  };
}


// IMPORTANT: Pass confirmer updates through confirmerOps instead of through messages
export async function createBlock(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ExtendedBlock> {
  const block = await createUnsignedBlock(prevBlock, messages, confirmerOps, newThreshold, ignoreConfirmerSetFail);
  block.header = await sign(signers, block.header);
  block.signers = signers;

  return block as ExtendedBlock;
}

export async function signBlock(
  block: UnsignedBlock,
  signers: Wallet | Wallet[]
): Promise<ExtendedBlock> {
  const wallets = Array.isArray(signers) ? signers : [signers];
  const newHeader = await sign(wallets, block.header);    
  return {
    ...block,
    header: newHeader,
    signers: wallets,
  };
}

export async function createGenesisBlock(
  messages: Message[],
  confirmerOps?: ConfirmerOp[],
  newThreshold?: number,
): Promise<GenesisBlock> {
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
    confirmerSet: confSet,
  };
}

export async function createBlockTemplate(prevBlock: ExtendedBlock) {
  return createBlock(prevBlock, [], []);
}

export async function getConfirmers(contract: FirmChain): Promise<ConfirmerValue[]> {
  const confBytes = await contract.getConfirmers();
  return confBytes.map(bytes => decodeConfirmer(bytes));
}
