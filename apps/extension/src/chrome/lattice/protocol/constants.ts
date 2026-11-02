/**
 * Lattice1 wire constants.
 *
 * Ported from ape-grid-lattice `ape_grid/protocol/constants.py`, which mirrors
 * gridplus-sdk `packages/types/src/protocol.ts` and `latticeConstants.ts`.
 */

export const LATTICE_PROTOCOL_VERSION_V1 = 0x01;

export const LatticeMsgType = {
  RESPONSE: 0x00,
  SECURE: 0x02,
} as const;

export const LatticeSecureMsgType = {
  CONNECT: 0x01,
  ENCRYPTED: 0x02,
} as const;
export type LatticeSecureMsgType =
  (typeof LatticeSecureMsgType)[keyof typeof LatticeSecureMsgType];

export const LatticeEncryptedRequestType = {
  FINALIZE_PAIRING: 0,
  GET_ADDRESSES: 1,
  SIGN: 3,
} as const;
export type LatticeEncryptedRequestType =
  (typeof LatticeEncryptedRequestType)[keyof typeof LatticeEncryptedRequestType];

export const LatticeResponseCode = {
  SUCCESS: 0x00,
  INVALID_MSG: 0x80,
  DEVICE_BUSY: 0x82,
  USER_TIMEOUT: 0x83,
  USER_DECLINED: 0x84,
  PAIR_FAILED: 0x85,
  PAIR_DISABLED: 0x86,
  PERMISSION_DISABLED: 0x87,
  GCE_TIMEOUT: 0x89,
  WRONG_WALLET: 0x8a,
  DEVICE_LOCKED: 0x8b,
  INVALID_EPHEM_ID: 0x8e,
} as const;

/** Only address strings (flag 0) are requested; pubkey flags are not used. */
export const LatticeGetAddressesFlag = {
  NONE: 0,
} as const;

export const LatticeSignSchema = {
  EXTRA_DATA: 4,
  GENERIC: 5,
} as const;

export const LatticeSignHash = {
  NONE: 0,
  KECCAK256: 1,
  SHA256: 2,
} as const;
export type LatticeSignHash = (typeof LatticeSignHash)[keyof typeof LatticeSignHash];

export const LatticeSignCurve = {
  SECP256K1: 0,
} as const;
export type LatticeSignCurve = (typeof LatticeSignCurve)[keyof typeof LatticeSignCurve];

export const LatticeSignEncoding = {
  NONE: 1,
  EVM: 4,
  EIP7702_AUTH: 6,
  EIP7702_AUTH_LIST: 7,
} as const;
export type LatticeSignEncoding =
  (typeof LatticeSignEncoding)[keyof typeof LatticeSignEncoding];

/** Static AES-256-CBC IV ("mysecretpassword"). Keys are fresh per message. */
export const LATTICE_AES_IV = new TextEncoder().encode("mysecretpassword");

export const LATTICE_ADDR_STR_LEN = 129;

export const LatticePairingStatus = {
  NOT_PAIRED: 0x00,
  PAIRED: 0x01,
} as const;

export const LATTICE_HEADER_SIZE = 8;
export const LATTICE_CHECKSUM_SIZE = 4;
export const LATTICE_PAYLOAD_REQ_CONNECT = 66;
export const LATTICE_PAYLOAD_REQ_ENCRYPTED = 1733;
export const LATTICE_DATA_REQ_CONNECT = 65;
export const LATTICE_DATA_REQ_ENCRYPTED = 1728;

export const LATTICE_REQUEST_DATA_SIZES: Readonly<Record<LatticeEncryptedRequestType, number>> = {
  [LatticeEncryptedRequestType.FINALIZE_PAIRING]: 99,
  [LatticeEncryptedRequestType.GET_ADDRESSES]: 54,
  [LatticeEncryptedRequestType.SIGN]: 1680,
};

export const LATTICE_RESPONSE_DATA_SIZES: Readonly<Record<LatticeEncryptedRequestType, number>> = {
  [LatticeEncryptedRequestType.FINALIZE_PAIRING]: 0,
  [LatticeEncryptedRequestType.GET_ADDRESSES]: 1290,
  [LatticeEncryptedRequestType.SIGN]: 1090,
};

export const LATTICE_EPHEMERAL_PUB_SIZE = 65;
export const LATTICE_DER_SIG_PADDED_SIZE = 74;
export const LATTICE_MSG_ID_LEN = 4;
export const LATTICE_WALLET_UID_LEN = 32;
export const LATTICE_HARDENED_OFFSET = 0x80000000;
export const LATTICE_DEFAULT_APP_NAME = "WalletChan";
