import { BytesLike, utils, Wallet, } from 'ethers';
import {
  Confirmer, Block, BlockHeader, Message, Signature, ConfirmerValue, BlockBody,

} from './types';

export function normalizeHexStr(str: string) {
  return utils.hexlify(str);
}

export function encodeBlockBody(body: BlockBody): BytesLike {
  const coder = utils.defaultAbiCoder;
  return coder.encode([
    "bytes32", "bytes32",
    "tuple(address addr, bytes cdata)[]",
  ], [body.confirmerSetId, body.mirror, body.msgs]);
}

export function getBlockBodyId(body: BlockBody): string;
export function getBlockBodyId(block: Block): string;
export function getBlockBodyId(block: BlockBody | Block): string {
  let encBody: BytesLike = encodeBlockBody(block);
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

export function randomByte() {
  return utils.randomBytes(1);
}

export function randomBytes32Hex(): string {
  return utils.hexlify(randomBytes32());
}

export function randomBytesHex(n: number): string {
  return utils.hexlify(utils.randomBytes(n));
}

export function randomSigBytes() {
  return utils.randomBytes(72);
}

export function randomSig(): Signature {
  return {
    r: randomBytes32(),
    s: randomBytes32(),
    v: randomByte(),
  };
}

export async function sign(wallet: Wallet, header: BlockHeader): Promise<Signature> {
  const digest = getBlockDigest(header);
  return await wallet._signingKey().signDigest(digest);
}

export async function batchSign(wallets: Wallet[], header: BlockHeader): Promise<Signature[]> {
  const sigs: Signature[] = [];
  for (const wallet of wallets) {
    sigs.push(await sign(wallet, header));
  }
  return sigs;
}
// export async function sign(wallets: Wallet[], header: BlockHeader): Promise<Signature[]>;
// export async function sign(w: Wallet[] | Wallet, header: BlockHeader): Promise<Signature[]> {
//   const wallets = Array.isArray(w) ? w : [w];
//   const digest = getBlockDigest(header);
//   const sigs: Signature[] = [];

//   for (const wallet of wallets) {
//     sigs.push(await wallet._signingKey().signDigest(digest));
//   }

//   return sigs;
// }


// TODO: This might not work if you pass promises as values in header
export function encodeHeader(header: BlockHeader) {
  return utils.solidityPack(
    ["bytes32", "bytes32", "uint"],
    [
      header.prevBlockId,
      header.blockBodyId,
      header.timestamp,
    ]
  );
}

// TODO: This might not work if you pass promises as values in header
export function getBlockDigest(header: BlockHeader): string {
  const encoded = encodeHeader(header);
  return utils.keccak256(encoded);
}

export function getBlockId(header: BlockHeader) {
  return utils.keccak256(encodeHeader(header));
}

export function getCurrentTimestamp() {
  return Math.trunc(Date.now() / 1000);
}
