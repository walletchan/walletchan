import {
  concatHex, encodeAbiParameters, encodeFunctionData, getAddress, getCreate2Address,
  keccak256, parseAbi, stringToHex, zeroAddress, type Hex,
} from "viem";
import { SAFE_4337_MODULE, SAFE_MODULE_SETUP } from "@walletchan/shared/safe4337";
import { assertBunkerChainId, BUNKER_CHAIN_DERIVATION_VERSION } from "./chainIdentity";

export const BUNKER_DEPLOYMENT_VERSION = 3;
const DOMAIN = keccak256(stringToHex("WalletChan.SafeBunker.shared-seed"));
export const BUNKER_FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address _singleton,bytes initializer,uint256 saltNonce) returns(address)",
  "function proxyCreationCode() view returns(bytes)",
]);
const SETUP_ABI = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
]);

/** Caller must verify canonical infrastructure on this exact chain before use. */
export interface BunkerIdentityProfile {
  readonly chainId: number;
  readonly factory: Hex;
  readonly singleton: Hex;
  readonly proxyCreationCode: Hex;
}

function address(value: Hex): Hex {
  const normalized = getAddress(value).toLowerCase() as Hex;
  if (normalized === zeroAddress) throw new Error("Invalid Bunker identity address");
  return normalized;
}

export function bunkerDeploymentSalt(chainId: number, initialOwner: Hex, version = BUNKER_DEPLOYMENT_VERSION): bigint {
  assertBunkerChainId(chainId);
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }],
    [DOMAIN, BigInt(version), BigInt(BUNKER_CHAIN_DERIVATION_VERSION), BigInt(chainId), address(initialOwner)],
  )));
}

/** Pure standard-factory prediction: never depends on local group IDs or payer. */
export function buildBunkerDeploymentIdentity(profile: BunkerIdentityProfile, initialOwner: Hex) {
  assertBunkerChainId(profile.chainId);
  const factory = address(profile.factory), singleton = address(profile.singleton), owner = address(initialOwner);
  const code = profile.proxyCreationCode;
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || code.length > 8194)
    throw new Error("Invalid Safe proxy creation code");
  const salt = bunkerDeploymentSalt(profile.chainId, owner, BUNKER_DEPLOYMENT_VERSION);
  const initializer = encodeFunctionData({ abi: SETUP_ABI, functionName: "setup",
    args: [[owner], 1n, SAFE_MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[SAFE_4337_MODULE]] }), SAFE_4337_MODULE, zeroAddress, 0n, zeroAddress] });
  const bytecode = concatHex([code, encodeAbiParameters([{ type: "address" }], [singleton])]);
  const create2Salt = keccak256(concatHex([keccak256(initializer), encodeAbiParameters([{ type: "uint256" }], [salt])]));
  const safeAddress = getCreate2Address({ from: factory, salt: create2Salt, bytecode }).toLowerCase() as Hex;
  return {
    deploymentVersion: BUNKER_DEPLOYMENT_VERSION, derivationVersion: BUNKER_CHAIN_DERIVATION_VERSION,
    chainId: profile.chainId, factory, singleton, initialOwner: owner, salt: salt.toString(), initializer,
    proxyCreationCodeHash: keccak256(code), address: safeAddress,
    accountId: `bunker:${profile.chainId}:${safeAddress}`,
    deploymentData: encodeFunctionData({ abi: BUNKER_FACTORY_ABI, functionName: "createProxyWithNonce", args: [singleton, initializer, salt] }),
  } as const;
}
