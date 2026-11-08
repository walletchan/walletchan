/** Exact decoding for persisted Lattice account rows at the repository read boundary. */
import { getAddress, isAddress } from "viem";
import type { LatticeAccount } from "../types";
import { LATTICE_DERIVATION_TEMPLATES, latticeDerivationPath, type LatticeDerivationScheme } from "./derivation";

const EXPECTED_KEYS = new Set(["address", "createdAt", "deviceId", "displayName", "hdIndex", "hdPath", "id", "type"]);

export function isReleasedLatticePath(hdPath: string, hdIndex: number): boolean {
  if (!Number.isSafeInteger(hdIndex) || hdIndex < 0) return false;
  return (Object.keys(LATTICE_DERIVATION_TEMPLATES) as LatticeDerivationScheme[]).some(
    (scheme) => latticeDerivationPath(scheme, hdIndex) === hdPath,
  );
}

export function decodeLatticeAccount(value: unknown): LatticeAccount {
  const row = (value ?? {}) as Record<string, unknown>;
  const { id, address, deviceId, hdPath, hdIndex, displayName, createdAt } = row;
  if (
    Object.keys(row).some((key) => !EXPECTED_KEYS.has(key)) || row.type !== "lattice" ||
    typeof id !== "string" || id.length < 1 || id.length > 128 ||
    typeof address !== "string" || !isAddress(address) || typeof deviceId !== "string" || !isAddress(deviceId) ||
    typeof hdPath !== "string" || typeof hdIndex !== "number" || !isReleasedLatticePath(hdPath, hdIndex) ||
    (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 100)) ||
    typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0
  ) {
    throw new Error("Invalid Lattice account storage.");
  }
  return {
    id, type: "lattice", address: getAddress(address), deviceId: deviceId.toLowerCase(), hdPath, hdIndex, createdAt,
    ...(displayName === undefined ? {} : { displayName: displayName as string }),
  };
}
