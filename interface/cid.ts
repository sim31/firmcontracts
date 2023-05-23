import { ethers } from 'ethers';

// https://ethereum.stackexchange.com/a/39961/12608

// Return bytes32 hex string from base58 encoded ipfs hash,
// stripping leading 2 bytes from 34 byte IPFS hash
// Assume IPFS defaults: function:0x12=sha2, size:0x20=256 bits
// E.g. "QmNSUYVKDSvPUnRLKmuxk9diJ6yS96r1TrAXzjTiBcCLAL" -->
// "0x017dfd85d4f6cb4dcd715a88101f7b1f06cd1e009b2327a0809d01eb9c91f231"

export function cid0ToBytes32Str(cid: string): string {
  const val = ethers.utils.hexlify(
    ethers.utils.base58.decode(cid).slice(2)
  );
  return val;
}

// Return base58 encoded ipfs hash from bytes32 hex string,
// E.g. "0x017dfd85d4f6cb4dcd715a88101f7b1f06cd1e009b2327a0809d01eb9c91f231"
// --> "QmNSUYVKDSvPUnRLKmuxk9diJ6yS96r1TrAXzjTiBcCLAL"

export function bytes32StrToCid0(bytes32: string): string {
  // Add our default ipfs values for first 2 bytes:
  // function:0x12=sha2, size:0x20=256 bits
  // and cut off leading "0x"
  const hashHex = `0x1220${bytes32.slice(2)}`
  const hashBytes = ethers.utils.arrayify(hashHex);
  const cid = ethers.utils.base58.encode(hashBytes)
  return cid;
}
