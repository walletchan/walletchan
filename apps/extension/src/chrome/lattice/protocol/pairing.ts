/**
 * Connect-response decoding and pairing-request encoding.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/pairing.py`, which mirrors
 * gridplus-sdk `functions/connect.ts`, `functions/pair.ts`,
 * `shared/utilities.ts` (parseWallets) and `util.ts` (generateAppSecret).
 */
import { sha256 } from "viem";

import { concatBytes, isAllZero } from "./bytes";
import { LATTICE_EPHEMERAL_PUB_SIZE, LatticePairingStatus } from "./constants";
import type { LatticeFirmwareVersion } from "./firmware";
import {
  assertUncompressedP256,
  latticeAesDecrypt,
  latticeAppPublicKey,
  latticeSharedSecret,
  signDigestDerPadded,
} from "./secureChannel";

export interface LatticeWalletUids {
  internal: Uint8Array;
  /** All zeros when no SafeCard is inserted. */
  external: Uint8Array;
}

export interface LatticeConnectResult {
  isPaired: boolean;
  firmware: LatticeFirmwareVersion;
  ephemeralPub: Uint8Array;
  walletUids: LatticeWalletUids | null;
  /** External (SafeCard) wallet when present, else the internal wallet. */
  activeWalletUid: Uint8Array | null;
}

// Two 71-byte wallet descriptors, AES-padded. Firmware 0.18.9 sends 144 bytes;
// gridplus-sdk reads up to 160.
const MIN_WALLET_INFO_SIZE = 144;
const MAX_WALLET_INFO_SIZE = 160;
const WALLET_DESCRIPTOR_SIZE = 71;

export async function decodeConnectResponse(payload: Uint8Array, appPrivateKey: Uint8Array): Promise<LatticeConnectResult> {
  if (payload.length < 1 + LATTICE_EPHEMERAL_PUB_SIZE + 4) throw new Error("Lattice connect response too short");
  let off = 0;
  const isPaired = payload[off] === LatticePairingStatus.PAIRED;
  off += 1;
  const ephemeralPub = payload.slice(off, off + LATTICE_EPHEMERAL_PUB_SIZE);
  assertUncompressedP256(ephemeralPub);
  off += LATTICE_EPHEMERAL_PUB_SIZE;
  // Firmware bytes: |fix|minor|major|reserved|
  const firmware: LatticeFirmwareVersion = [payload[off + 2], payload[off + 1], payload[off]];
  off += 4;

  let walletUids: LatticeWalletUids | null = null;
  let activeWalletUid: Uint8Array | null = null;
  if (isPaired) {
    const encWallet = payload.subarray(off, off + MAX_WALLET_INFO_SIZE);
    if (encWallet.length < MIN_WALLET_INFO_SIZE || encWallet.length % 16) throw new Error("Lattice wallet info missing");
    const dec = await latticeAesDecrypt(encWallet, latticeSharedSecret(appPrivateKey, ephemeralPub));
    if (dec[dec.length - 1] !== 0 || dec[dec.length - 2] !== 0) {
      throw new Error("Failed to decrypt Lattice wallet info");
    }
    walletUids = {
      internal: dec.slice(0, 32),
      external: dec.slice(WALLET_DESCRIPTOR_SIZE, WALLET_DESCRIPTOR_SIZE + 32),
    };
    activeWalletUid = isAllZero(walletUids.external) ? walletUids.internal : walletUids.external;
  }
  return { isPaired, firmware, ephemeralPub, walletUids, activeWalletUid };
}

/** 25-byte zero-padded app name; empty when no pairing secret is sent. */
export function pairingNameBuffer(appName: string, pairingSecret: string): Uint8Array {
  const buf = new Uint8Array(25);
  if (pairingSecret) buf.set(new TextEncoder().encode(appName).slice(0, 25));
  return buf;
}

/** sha256(appPub(65) || nameBuf(25) || pairingSecret) */
export function pairingDigest(appPub: Uint8Array, nameBuf: Uint8Array, pairingSecret: string): Uint8Array {
  return sha256(concatBytes(appPub, nameBuf, new TextEncoder().encode(pairingSecret)), "bytes");
}

/** 99-byte payload: nameBuf(25) || paddedDerSig(74). */
export function encodePairRequest(appPrivateKey: Uint8Array, appName: string, pairingSecret: string): Uint8Array {
  if (!pairingSecret) throw new Error("Pairing code is required");
  const nameBuf = pairingNameBuffer(appName, pairingSecret);
  const digest = pairingDigest(latticeAppPublicKey(appPrivateKey), nameBuf, pairingSecret);
  return concatBytes(nameBuf, signDigestDerPadded(appPrivateKey, digest));
}
