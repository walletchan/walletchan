export const TREZOR_STATUS_SOURCE = "walletchan-trezor-connect";

export type TrezorSignerStatus =
  | "connecting"
  | "selecting-device"
  | "awaiting-confirmation"
  | "scanning"
  | "signing"
  | "success"
  | "error";

export type TrezorStatusUpdate = {
  type: "trezorStatus";
  source: typeof TREZOR_STATUS_SOURCE;
  opId: string;
  status: TrezorSignerStatus;
  errorCode?: string;
};

export interface TrezorConnectedDevice {
  deviceId: `0x${string}`;
  deviceLabel: string;
  deviceModel: string;
}

export interface TrezorAddress {
  address: `0x${string}`;
  hdPath: string;
  hdIndex: number;
}

export interface TrezorLegacyTransaction {
  to: string | null;
  value: string;
  gasPrice: string;
  gasLimit: string;
  nonce: string;
  data?: string;
  chainId: number;
}

export interface TrezorEip1559Transaction {
  to: string | null;
  value: string;
  gasLimit: string;
  nonce: string;
  data?: string;
  chainId: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
}

export type TrezorTransaction =
  | TrezorLegacyTransaction
  | TrezorEip1559Transaction;

export interface TrezorSignedTransaction {
  v: string;
  r: string;
  s: string;
  serializedTx: string;
}

export interface TrezorMessageSignature {
  address: string;
  signature: string;
}

export interface TrezorTypedDataSignature {
  address: string;
  signature: string;
}
