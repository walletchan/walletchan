/**
 * EVM function signature -> Lattice calldata decoder ("def") bytes.
 *
 * Ported from gridplus-sdk 4.0.0 `parseCanonicalName` (its 4byte path:
 * `parseTypeStr`, `parseParamDef`, `getTupleName`) and RLP-encoded as the SDK
 * sends it. Byte parity with the real SDK: tests/lattice/sdkParity.test.ts.
 * The decoder is a display hint: the device decodes the arguments from the
 * signed calldata, but shows the function name as given, so callers must
 * check the selector first.
 *
 * One deliberate difference: functions with fixed `bytesN` parameters get no
 * decoder. Real-device tests on firmware 0.18.9 (2026-11-02): with the SDK's
 * size N / 8, a bytes32 argument showed only its last 4 bytes, which
 * misleads; with size 32 the device refused the decoder. Nested decoders for
 * bytes arguments that hold calldata are refused too. Refused signatures sign
 * with raw data on the device.
 */
import { keccak256, toBytes, toRlp } from "viem";

const EVM_TYPES = [null, "address", "bool", "uint", "int", "bytes", "string", "tuple", "nestedDef"] as const;
const TUPLE = EVM_TYPES.indexOf("tuple");

export class LatticeDecoderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatticeDecoderUnsupportedError";
  }
}

interface FlatParam {
  typeIdx: number;
  szBytes: number;
  arraySzs: number[];
}
/** A tuple contributes its own FlatParam followed by an array of its members. */
type FlatDef = Array<FlatParam | FlatDef>;
type DecoderParam = [name: string, typeIdx: number, szBytes: number, arraySzs: number[], members?: DecoderParam[]];
type DecoderDef = [functionName: string, ...params: DecoderParam[]];

export function functionSelector(canonicalName: string): Uint8Array {
  return keccak256(toBytes(canonicalName), "bytes").slice(0, 4);
}

function unsupported(signature: string): never {
  throw new LatticeDecoderUnsupportedError(`No Lattice decoder for ${signature}`);
}

/** `[2][]` -> [2, 0] (SDK `getArraySzs`). */
function arraySzs(suffix: string, signature: string): number[] {
  if (!/^(?:\[\d*\])*$/.test(suffix)) unsupported(signature);
  return [...suffix.matchAll(/\[(\d*)\]/g)].map((match) => (match[1] ? Number(match[1]) : 0));
}

function parseBasicType(typeStr: string, signature: string): FlatParam {
  const match = /^([a-z]+)(\d*)((?:\[\d*\])*)$/.exec(typeStr);
  if (!match) unsupported(signature);
  const [, base, width, suffix] = match;
  const typeIdx = EVM_TYPES.indexOf(base as (typeof EVM_TYPES)[number]);
  if (typeIdx < 1 || typeIdx >= TUPLE) unsupported(signature);
  let szBytes = 0;
  if (width) {
    const bits = Number(width);
    const sized = base === "uint" || base === "int";
    if (!sized || bits === 0 || bits % 8 !== 0 || bits > 256) unsupported(signature);
    szBytes = bits / 8;
  }
  return { typeIdx, szBytes, arraySzs: arraySzs(suffix, signature) };
}

/** The leading `(...)` group, with its array suffix unless `withArr` is false (SDK `getTupleName`). */
function tupleName(name: string, withArr: boolean, signature: string): string {
  let depth = 0;
  for (let i = 0; i < name.length; i += 1) {
    if (name[i] === "(") depth += 1;
    else if (name[i] === ")") depth -= 1;
    const next = name[i + 1];
    const canBreak = next === "," || next === ")" || i === name.length - 1 || (!withArr && next === "[");
    if (depth === 0 && i > 0 && canBreak) return name.slice(0, i + 1);
  }
  return unsupported(signature);
}

/** Next parameter type from `a,b)`-style text (SDK `popTypeStrFromCanonical`). */
function popTypeStr(rest: string, signature: string): string {
  if (rest.startsWith("(")) return tupleName(rest, true, signature);
  const end = rest.search(/[,)]/);
  return end < 0 ? unsupported(signature) : rest.slice(0, end);
}

function parseTypeStr(typeStr: string, signature: string): FlatDef {
  if (!typeStr.startsWith("(")) return [parseBasicType(typeStr, signature)];
  const bare = tupleName(typeStr, false, signature);
  const tuple: FlatParam = { typeIdx: TUPLE, szBytes: 0, arraySzs: arraySzs(typeStr.slice(bare.length), signature) };
  let rest = bare.slice(1);
  const members: FlatDef = [];
  while (rest.length > 0) {
    const sub = popTypeStr(rest, signature);
    rest = rest.slice(sub.length + 1);
    members.push(...parseTypeStr(sub, signature));
  }
  if (members.length === 0) unsupported(signature);
  return [tuple, members];
}

/** Names `#1`, `#2`...; a tuple's members get `#<its index in this list>-<n>` (SDK `parseParamDef`). */
function parseParamDef(def: FlatDef, prefix = ""): DecoderParam[] {
  const parsed: DecoderParam[] = [];
  let tuples = 0;
  def.forEach((param, i) => {
    if (Array.isArray(param)) {
      parsed[parsed.length - 1].push(parseParamDef(param, `${i}-`) as never);
      return;
    }
    parsed.push([`#${prefix}${i + 1 - tuples}`, param.typeIdx, param.szBytes, param.arraySzs]);
    if (param.typeIdx === TUPLE) tuples += 1;
  });
  return parsed;
}

export function parseCanonicalSignature(signature: string): DecoderDef {
  const open = signature.indexOf("(");
  const opens = signature.split("(").length;
  if (open <= 0 || !signature.endsWith(")") || /\s/.test(signature) || opens !== signature.split(")").length) {
    unsupported(signature);
  }
  let rest = signature.slice(open + 1);
  const flat: FlatDef = [];
  while (rest.length > 1) {
    const typeStr = popTypeStr(rest, signature);
    flat.push(...parseTypeStr(typeStr, signature));
    rest = rest.slice(typeStr.length + 1);
  }
  return [signature.slice(0, open), ...parseParamDef(flat)];
}

type RlpItem = Uint8Array | RlpItem[];

function toRlpItem(value: unknown): RlpItem {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Decoder integers must be non-negative");
    if (value === 0) return new Uint8Array(0);
    const bytes: number[] = [];
    for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
    return Uint8Array.from(bytes);
  }
  if (Array.isArray(value)) return value.map(toRlpItem);
  throw new Error("Unexpected decoder value");
}

/** RLP-encoded decoder for a canonical signature such as `transfer(address,uint256)`. */
export function encodeEvmDecoder(canonicalName: string): Uint8Array {
  return toRlp(toRlpItem(parseCanonicalSignature(canonicalName)) as never, "bytes");
}

interface AbiInput {
  name?: string;
  type: string;
  components?: readonly AbiInput[];
}

/**
 * RLP-encoded decoder from a JSON ABI function, so the device shows the
 * parameter names (gridplus-sdk `parseSolidityJSONABI` / `parseDef`). An
 * unnamed parameter is labelled by position.
 */
export function encodeEvmDecoderForFunction(item: { name: string; inputs: readonly AbiInput[] }): Uint8Array {
  const signature = item.name;
  const param = (input: AbiInput, index: number): DecoderParam => {
    const label = input.name || `#${index + 1}`;
    if (input.type.startsWith("tuple")) {
      if (!input.components?.length) unsupported(signature);
      return [label, TUPLE, 0, arraySzs(input.type.slice(5), signature), input.components.map(param)];
    }
    const { typeIdx, szBytes, arraySzs: dims } = parseBasicType(input.type, signature);
    return [label, typeIdx, szBytes, dims];
  };
  return toRlp(toRlpItem([item.name, ...item.inputs.map(param)]) as never, "bytes");
}
