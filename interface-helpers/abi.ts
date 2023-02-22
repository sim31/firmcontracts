import { BytesLike, utils, ethers, Wallet } from 'ethers';
import {
  Confirmer, Block, BlockHeader, Message, Signature, ZeroAddr, ZeroId, ConfirmerOutput, ConfirmerValue,

} from './types';

export function normalizeHexStr(str: string) {
  return utils.hexlify(str);
}

export function encodeBlockBody(calls: readonly Message[]): BytesLike {
  const coder = utils.defaultAbiCoder;
  return coder.encode(["tuple(address addr, bytes cdata)[]"], [calls]);
}

export function getBlockBodyId(calls: Message[]): string;
export function getBlockBodyId(block: Block): string;
export function getBlockBodyId(callsOrBlock: Block | Message[]): string {
  let encBody: BytesLike =  ""; 
  if (Array.isArray(callsOrBlock)) {
    encBody = encodeBlockBody(callsOrBlock);
  } else {
    encBody = encodeBlockBody(callsOrBlock.msgs);
  }
  return utils.keccak256(encBody);
}

// TODO: Test that returned bytes.length is 66
export async function encodeConfirmer(conf: Confirmer): Promise<BytesLike> {
  const bytes = utils.hexConcat(
    [utils.zeroPad("0x00", 11),
    await Promise.resolve(conf.addr),
    [Number((await Promise.resolve(conf.weight)).toString())]
  ]);
  return bytes;
}

export function decodeConfirmer(b: BytesLike): ConfirmerValue {
  const confirmer: ConfirmerValue = {
    addr: utils.hexDataSlice(b, 11, 31),
    weight: utils.arrayify(utils.hexDataSlice(b, 31, 32))[0],

  }
  return confirmer;
}

export async function getConfirmerSetId(confs: Confirmer[], threshold: number): Promise<string> {
  let packedConfs: BytesLike[] = [];
  for (const c of confs) {
    packedConfs.push(await encodeConfirmer(c));
  }
  return utils.solidityKeccak256(["uint8", "bytes32[]"], [threshold, packedConfs]);
}

export function randomBytes32() {
  return utils.randomBytes(32);
}

export function randomBytes32Hex(): string {
  return utils.hexlify(randomBytes32());
}

export function randomBytesHex(n: number): string {
  return utils.hexlify(utils.randomBytes(n));
}

export function randomSig() {
  return utils.randomBytes(72);
}

export async function packSig(sig: Signature): Promise<BytesLike> {
  const v = await Promise.resolve(sig.v);
  return utils.concat([await Promise.resolve(sig.r), await Promise.resolve(sig.s), utils.hexlify(v)]);
}

export async function setBlockSignatures(header: BlockHeader, sigs: Signature[]): Promise<void> {
  let packedSigs: BytesLike[] = [];
  for (const sig of sigs) {
    packedSigs.push(await packSig(sig));
  }
  header.sigs = utils.concat(packedSigs);
}

export async function sign(wallet: Wallet, header: BlockHeader): Promise<BlockHeader>;
export async function sign(wallets: Wallet[], header: BlockHeader): Promise<BlockHeader>;
export async function sign(w: Wallet[] | Wallet, header: BlockHeader): Promise<BlockHeader> {
  const wallets = Array.isArray(w) ? w : [w];
  const prevSigs = await Promise.resolve(header.sigs);
  const digest = getBlockDigest(header);
  const sigs: BytesLike[] = [];

  for (const wallet of wallets) {
    sigs.push(await packSig(wallet._signingKey().signDigest(digest)));
  }

  return {
    ...header,
    sigs: utils.concat([prevSigs, ...sigs]),
  };
}


// TODO: This might not work if you pass promises as values in header
export function encodeHeader(header: BlockHeader) {
  return utils.solidityPack(
    ["bytes32", "bytes32", "bytes32", "uint", "bytes"],
    [
      header.prevBlockId,
      header.blockBodyId,
      header.confirmerSetId,
      header.timestamp,
      header.sigs
    ]
  );
}

// TODO: This might not work if you pass promises as values in header
export function getBlockDigest(header: BlockHeader): string {
  const encoded = utils.solidityPack(
    ["bytes32", "bytes32", "bytes32", "uint"],
    [
      header.prevBlockId,
      header.blockBodyId,
      header.confirmerSetId,
      header.timestamp
    ]
  );

  return utils.keccak256(encoded);
}

export function getBlockId(header: BlockHeader) {
  return utils.keccak256(encodeHeader(header));
}
