/**
 * EVM ABI signature -> Lattice calldata decoder ("def") bytes.
 *
 * Ported from ape-grid-lattice `ape_grid/calldata.py`, which mirrors
 * gridplus-sdk `calldata/evm.ts`. The decoder is a display hint only: the
 * device checks the parameter layout but shows the function name and labels as
 * given, so decoders must come from trusted ABI sources.
 *
 * Scope: address, bool, uint<N>, int<N>, bytes<N>, bytes, string and arrays of
 * those. Tuples and nested definitions throw until the parity work adds them.
 */
import { keccak256, toBytes, toRlp } from "viem";

const EVM_TYPES = [null, "address", "bool", "uint", "int", "bytes", "string", "tuple", "nestedDef"] as const;

export class LatticeDecoderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatticeDecoderUnsupportedError";
  }
}

type DecoderParam = [name: string, typeIdx: number, szBytes: number, arraySzs: number[]];
type DecoderDef = [functionName: string, ...params: DecoderParam[]];

export function functionSelector(canonicalName: string): Uint8Array {
  return keccak256(toBytes(canonicalName), "bytes").slice(0, 4);
}

function parseArrayDims(typeStr: string): { base: string; dims: number[] } {
  const dims: number[] = [];
  let base = typeStr;
  while (base.endsWith("]")) {
    const open = base.lastIndexOf("[");
    if (open < 0) throw new Error(`Malformed array type: ${typeStr}`);
    const inner = base.slice(open + 1, -1);
    if (inner && !/^\d+$/.test(inner)) throw new Error(`Malformed array size: ${typeStr}`);
    dims.unshift(inner ? Number(inner) : 0);
    base = base.slice(0, open);
  }
  return { base, dims };
}

function parseBasicType(typeStr: string): { typeIdx: number; szBytes: number; dims: number[] } {
  const { base, dims } = parseArrayDims(typeStr);
  for (let idx = 0; idx < EVM_TYPES.length; idx += 1) {
    const name = EVM_TYPES[idx];
    if (!name || name === "tuple" || name === "nestedDef") continue;
    if (!base.startsWith(name)) continue;
    const tail = base.slice(name.length);
    if (tail && !/^\d+$/.test(tail)) continue;
    let szBytes = 0;
    if (tail) {
      const width = Number(tail);
      if (name === "uint" || name === "int") {
        if (width % 8 !== 0 || width > 256 || width === 0) throw new Error(`Bad int width: ${typeStr}`);
        szBytes = width / 8;
      } else if (name === "bytes") {
        if (width < 1 || width > 32) throw new Error(`Bad bytes size: ${typeStr}`);
        szBytes = width;
      } else {
        throw new Error(`Type does not take size: ${typeStr}`);
      }
    }
    return { typeIdx: idx, szBytes, dims };
  }
  throw new Error(`Unknown EVM type: ${typeStr}`);
}

function splitTopLevelParams(inside: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const ch = inside[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(inside.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inside.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

export function parseCanonicalSignature(canonicalName: string): DecoderDef {
  const open = canonicalName.indexOf("(");
  const close = canonicalName.lastIndexOf(")");
  if (open <= 0 || close !== canonicalName.length - 1) {
    throw new Error(`Malformed function signature: ${canonicalName}`);
  }
  const inside = canonicalName.slice(open + 1, close);
  if (inside.includes("(")) {
    throw new LatticeDecoderUnsupportedError(`Tuple parameters are not yet supported: ${canonicalName}`);
  }
  const def: DecoderDef = [canonicalName.slice(0, open)];
  splitTopLevelParams(inside).forEach((typeStr, i) => {
    const { typeIdx, szBytes, dims } = parseBasicType(typeStr);
    def.push([`#${i + 1}`, typeIdx, szBytes, dims]);
  });
  return def;
}

type RlpItem = Uint8Array | RlpItem[];

function toRlpItem(value: string | number | readonly unknown[]): RlpItem {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Decoder integers must be non-negative");
    if (value === 0) return new Uint8Array(0);
    const bytes: number[] = [];
    for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
    return Uint8Array.from(bytes);
  }
  return value.map((item) => toRlpItem(item as string | number | readonly unknown[]));
}

/** RLP-encoded decoder for a canonical signature such as `transfer(address,uint256)`. */
export function encodeEvmDecoder(canonicalName: string): Uint8Array {
  return toRlp(toRlpItem(parseCanonicalSignature(canonicalName)) as never, "bytes");
}
