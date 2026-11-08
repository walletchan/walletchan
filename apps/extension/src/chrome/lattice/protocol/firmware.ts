/**
 * Firmware limits for the generic-signing and ETH_MSG paths (firmware >= 0.15.0).
 * Ported from ape-grid-lattice `ape_grid/protocol/firmware.py`; the ETH_MSG
 * limits come from gridplus-sdk `getFwVersionConst`.
 */

export interface LatticeFirmwareConstants {
  readonly reqMaxDataSz: number;
  readonly extraDataFrameSz: number;
  readonly extraDataMaxFrames: number;
  readonly varAddrPathSzAllowed: boolean;
  readonly prehashAllowed: boolean;
  readonly gsBaseReqSz: number;
  readonly gsBaseDataSz: number;
  readonly decoderReserved: number;
  readonly decoderMaxSz: number;
  /** ETH_MSG message bytes in the base frame: reqMaxDataSz - 128 - 10. */
  readonly ethMsgMaxBaseSz: number;
  /** Room the device reserves for the EIP-191 header it adds. */
  readonly personalSignHeaderSz: number;
}

export const LATTICE_FW_DEFAULT: LatticeFirmwareConstants = Object.freeze({
  reqMaxDataSz: 1678,
  extraDataFrameSz: 1500,
  extraDataMaxFrames: 1,
  varAddrPathSzAllowed: true,
  prehashAllowed: true,
  gsBaseReqSz: 1552,
  gsBaseDataSz: 1519,
  decoderReserved: 2895728,
  decoderMaxSz: 1024,
  ethMsgMaxBaseSz: 1540,
  personalSignHeaderSz: 72,
});

/** Largest payload the device receives in full; larger payloads are prehashed. */
export function gsMaxExpandedSize(fw: LatticeFirmwareConstants): number {
  return fw.gsBaseDataSz + fw.extraDataMaxFrames * fw.extraDataFrameSz;
}

export type LatticeFirmwareVersion = readonly [major: number, minor: number, fix: number];

export const LATTICE_MIN_FIRMWARE: LatticeFirmwareVersion = [0, 15, 0];

export function isSupportedLatticeFirmware(version: LatticeFirmwareVersion): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== LATTICE_MIN_FIRMWARE[i]) return version[i] > LATTICE_MIN_FIRMWARE[i];
  }
  return true;
}

export function formatLatticeFirmware(version: LatticeFirmwareVersion): string {
  return version.join(".");
}
