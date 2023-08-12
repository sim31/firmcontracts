import {
  Confirmer, ConfirmerOp, ConfirmerOpId, ExtendedBlock, isConfirmer, Message,
  UnsignedBlock, BlockHeader, ConfirmerSet, InitConfirmerSet, ZeroId,
  GenesisBlock, NoContractBlock, ConfirmerValue, GenesisBlockValue, toValue, ConfirmerOpValue, ExtendedBlockValue, OptExtendedBlockValue, AddressStr, isWallet, AccountValue, BlockBody, Unpromised, UnsignedBlockValue,
} from './types'
import { Wallet, BaseContract, BytesLike } from 'ethers';
import { normalizeHexStr, getBlockBodyId, getBlockId, sign, getConfirmerSetId, decodeConfirmer, getCurrentTimestamp, randomBytes32, batchSign, } from './abi';
import { FirmChain, FirmChain__factory, IFirmChain } from '../typechain-types';
import { SignedBlockStruct } from '../typechain-types/contracts/FirmChain.js';

export function createAddConfirmerOps(confs: Confirmer[]): ConfirmerOp[] {
  return confs.map(conf => { return {opId:  ConfirmerOpId.Add, conf} });
}

export function createConfirmer(confWallet: Wallet, weight: number): ConfirmerValue {
  return {
    addr: normalizeHexStr(confWallet.address), weight,
  };
}

export function createAddConfirmerOp(confirmer: Wallet | AddressStr, weight: number): ConfirmerOpValue;
export function createAddConfirmerOp(
  confirmer: Wallet | { chain: { address: AddressStr }},
  weight: number
): ConfirmerOpValue;
export function createAddConfirmerOp(confirmer: ConfirmerValue): ConfirmerOpValue;
export function createAddConfirmerOp(
  confirmer: ConfirmerValue | Wallet | AddressStr | { chain: { address: AddressStr }},
  weight?: number
): ConfirmerOpValue {
  const conf = isConfirmer(confirmer) ? confirmer : 
    (isWallet(confirmer) ? createConfirmer(confirmer, weight ?? 0) :
      (typeof confirmer === 'string' ? { addr: confirmer, weight: weight ?? 0 } :
        { addr: confirmer.chain.address, weight: weight ?? 0 }));
  const op: ConfirmerOpValue = {
    opId: ConfirmerOpId.Add,
    conf,
  };
  return op;
}

export function createRemoveConfirmerOp(confWallet: Wallet, weight: number): ConfirmerOpValue;
export function createRemoveConfirmerOp(confirmer: ConfirmerValue): ConfirmerOpValue;
export function createRemoveConfirmerOp(confirmer: Wallet | ConfirmerValue, weight?: number) {
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
  confirmerOps?: Readonly<ConfirmerOpValue[]>,
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
          confs[toDeleteIndex] = lastConf!;
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
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<UnsignedBlock> {
  const prevHeader = prevBlock.header;

  let confSet = prevBlock.state.confirmerSet;
  try {
    confSet = updatedConfirmerSet(prevBlock.state.confirmerSet, confirmerOps, newThreshold);
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

  const body: BlockBody = {
    confirmerSetId: await getConfirmerSetId(confSet.confirmers, confSet.threshold),
    msgs: messages,
  };

  let newHeader: BlockHeader = {
    prevBlockId: getBlockId(prevHeader),
    blockBodyId: getBlockBodyId(body),
    timestamp: getCurrentTimestamp(),
  };

  return {
    ...body,
    contract: prevBlock.contract,
    header: newHeader,
    state: {
      confirmerSet: confSet,
      blockNum: prevBlock.state.blockNum + 1,
      blockId: getBlockId(newHeader),
    },
  };
}

export function toSignedBlock(bl: ExtendedBlock): SignedBlockStruct {
  return {
    bl: {
      header: bl.header,
      confirmerSetId: bl.confirmerSetId,
      msgs: bl.msgs,
    },
    sigs: bl.signatures,
    signers: bl.signers.map(w => w.address)
  }
}

export function toSignedBlocks(bls: ExtendedBlock[]): SignedBlockStruct[] {
  return bls.map(b => toSignedBlock(b));
}


// IMPORTANT: Pass confirmer updates through confirmerOps instead of through messages
export async function createBlock(
  prevBlock: ExtendedBlock,
  messages: Message[],
  signers: Wallet[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<ExtendedBlock> {
  const block = await createUnsignedBlock(prevBlock, messages,  confirmerOps, newThreshold, ignoreConfirmerSetFail);
  const sigs = await batchSign(signers, block.header);
  block.signers = signers;
  block.signatures = sigs;

  return block as ExtendedBlock;
}

export async function signBlock(
  block: UnsignedBlock,
  signers: Wallet | Wallet[]
): Promise<ExtendedBlock> {
  const wallets = Array.isArray(signers) ? signers : [signers];
  const sigs = await batchSign(wallets, block.header);    
  return {
    ...block,
    signers: wallets,
    signatures: sigs,
  };
}

export async function createGenesisBlock(
  messages: Message[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
): Promise<GenesisBlock> {
  const confSet = updatedConfirmerSet(InitConfirmerSet, confirmerOps, newThreshold);

  const blockBody: BlockBody = {
    confirmerSetId: await getConfirmerSetId(confSet.confirmers, confSet.threshold),
    msgs: messages,
  };

  let newHeader: BlockHeader = {
    prevBlockId: ZeroId,
    blockBodyId: getBlockBodyId(blockBody),
    // TODO: Set current time
    timestamp: getCurrentTimestamp(),
  }

  return {
    ...blockBody,
    header: newHeader,
    state: {
      confirmerSet: confSet,
      blockNum: 0,
      blockId: getBlockId(newHeader),
    },
  };
}

export async function createGenesisBlockVal(...args: Parameters<typeof createGenesisBlock>): Promise<GenesisBlockValue> {
  const values = await toValue(await createGenesisBlock(...args));
  return {
    ...values,
    contract: values.contract?.address,
    signers: values.signers?.map(s => s.address),
    signatures: values.signatures,
  };
}

export async function createUnsignedBlockVal(
  prevBlockVal: OptExtendedBlockValue,
  contract: IFirmChain,
  messages: Message[],
  confirmerOps?: ConfirmerOpValue[],
  newThreshold?: number,
  ignoreConfirmerSetFail?: boolean,
): Promise<UnsignedBlockValue> {
  if (contract.address !== prevBlockVal.contract) {
    throw new Error("Contract address in block does not match passed contract");
  }
  const prevBlock: ExtendedBlock = {
    ...prevBlockVal,
    contract,
    signers: [], // won't be used anyway
    signatures: prevBlockVal.signatures ? prevBlockVal.signatures : [],
  };

  const block = await createUnsignedBlock(
    prevBlock,
    messages, confirmerOps, newThreshold,
    ignoreConfirmerSetFail
  );

  // We know that createUnsignedBlock does not store any values as promises
  const values = block as Unpromised<UnsignedBlock>;
  return {
    ...values,
    contract: values.contract?.address,
    signers: values.signers?.map(s => s.address),
    signatures: [], // This is unsigned block
  };
  
}

export async function createBlockTemplate(prevBlock: ExtendedBlock) {
  return createBlock(prevBlock, [], []);
}

export async function getConfirmers(contract: FirmChain): Promise<ConfirmerValue[]> {
  const confBytes = await contract.getConfirmers();
  return confBytes.map(bytes => decodeConfirmer(bytes));
}

export function withConfirmInfo(
  prevBlock: OptExtendedBlockValue,
  block: OptExtendedBlockValue
): OptExtendedBlockValue {
  const b = { ...block };    
  b.state.confirmCount = 0;
  b.state.totalWeight = 0;
  for (const conf of prevBlock.state.confirmerSet.confirmers) {
    if (b.signers?.find(s => s === conf.addr)) {
      b.state.confirmCount++;
    }
    b.state.totalWeight += conf.weight;
  }
  b.state.thresholdThis = b.state.confirmerSet.threshold;

  return b;
}

// Returns all blocks except oldest (cause we don't know its confirm info)
export function blocksWithConfirmInfo(
  blocks: OptExtendedBlockValue[] // 0th - oldest, last - newest
): OptExtendedBlockValue[] {
  const bs = new Array<OptExtendedBlockValue>();
  let index = 1;
  while (index < blocks.length) {
    bs.push(withConfirmInfo(blocks[index-1]!, blocks[index]!));
    index++;
  }
  return bs;
}
