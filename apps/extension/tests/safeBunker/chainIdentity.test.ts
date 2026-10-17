import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, HDNodeWallet, Interface, getCreate2Address, keccak256, concat, toUtf8Bytes } from "ethers";
import { decodeFunctionData, getAddress, parseAbi, zeroAddress, type Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { bunkerChainOwnerPath, bunkerOwnerPathComponents } from "../../src/chrome/safeBunker/chainIdentity";
import { deriveBunkerChainOwner, withBunkerChainOwnerKey } from "../../src/chrome/safeBunker/chainOwnerDerivation";
import { buildBunkerDeploymentIdentity, bunkerDeploymentSalt } from "../../src/chrome/safeBunker/deploymentIdentity";

// Published BIP39 test vector, never a user's recovery material.
const phrase = `${"abandon ".repeat(11)}about`;
const vectors = [
  [1, 0, "m/44'/60'/1464027214'/2'/0'/1'/0'", "0xfd4188ec55e5efa1a0b2c7255c297c8f59c773ea"],
  [11155111, 0, "m/44'/60'/1464027214'/2'/0'/11155111'/0'", "0x71af960bbdec82837766ecfa486b55734fbbf706"],
  [84532, 0, "m/44'/60'/1464027214'/2'/0'/84532'/0'", "0x6d6de14eb38807a1537b47c9f150065e452a2c44"],
  [84532, 1, "m/44'/60'/1464027214'/2'/0'/84532'/1'", "0xf7b8bf04e1b47c7c2f080fb1d6a8a75e9a4e1790"],
  [2147483648, 0, "m/44'/60'/1464027214'/2'/1'/0'/0'", "0xe44d58423db7b502267ea067792acdae29225a4f"],
  [9007199254740991, 2147483647, "m/44'/60'/1464027214'/2'/4194303'/2147483647'/2147483647'", "0x3b92599b853d9d859871053d7e9297729dea5423"],
] as const;

test("chain owner paths match frozen independent ethers vectors", () => {
  for (const [chainId, index, path, owner] of vectors) {
    assert.equal(bunkerChainOwnerPath(chainId, index), path);
    assert.equal(deriveBunkerChainOwner(phrase, chainId, index), owner);
    assert.equal(HDNodeWallet.fromPhrase(phrase, "", path).address.toLowerCase(), owner);
  }
});

test("chain ID encoding is lossless at component boundaries and cannot wrap", () => {
  const paths = new Set<string>();
  for (const chainId of [1, 2, 11155111, 84532, 2147483647, 2147483648, 2147483649, 4294967296, Number.MAX_SAFE_INTEGER]) {
    const components = bunkerOwnerPathComponents(chainId, 0);
    assert.ok(components.every(n => Number.isInteger(n) && n >= 0 && n <= 0x7fffffff));
    assert.equal(BigInt(components[4]) * (1n << 31n) + BigInt(components[5]), BigInt(chainId));
    paths.add(bunkerChainOwnerPath(chainId, 0));
  }
  assert.equal(paths.size, 9);
});

test("ordinary EOA, alpha, chain and rotation owner branches are distinct", () => {
  const owners = new Set<string>();
  for (const chainId of [1, 84532, 11155111]) {
    for (const index of [0, 1, 2, 256]) owners.add(deriveBunkerChainOwner(phrase, chainId, index));
  }
  for (const index of [0, 1, 2, 256]) {
    owners.add(HDNodeWallet.fromPhrase(phrase, "", `m/44'/60'/0'/0/${index}`).address.toLowerCase());
    owners.add(HDNodeWallet.fromPhrase(phrase, "", `m/44'/60'/0'/0'/${index}'`).address.toLowerCase());
  }
  assert.equal(owners.size, 20);
});

test("invalid selectors and mnemonic never reach owner-key use", async () => {
  let invoked = false;
  const use = async () => { invoked = true; };
  for (const chainId of [0, -1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1, "84532", 84532n, null, true]) {
    assert.throws(() => bunkerChainOwnerPath(chainId as number, 0));
    await assert.rejects(withBunkerChainOwnerKey(phrase, chainId as number, 0, use));
  }
  for (const index of [-1, 0.1, NaN, Infinity, 2147483648, "0", null]) {
    await assert.rejects(withBunkerChainOwnerKey(phrase, 1, index as number, use));
  }
  for (const invalid of ["", ` ${phrase}`, phrase.toUpperCase(), "abandon ".repeat(12).trim(), "abandon ".repeat(23) + "art"]) {
    await assert.rejects(withBunkerChainOwnerKey(invalid, 1, 0, use));
  }
  assert.equal(invoked, false);
});

test("scoped owner keys match public derivation across async success and failure", async () => {
  const expected = deriveBunkerChainOwner(phrase, 84532, 1);
  const actual = await withBunkerChainOwnerKey(phrase, 84532, 1, async key => {
    await Promise.resolve();
    return privateKeyToAddress(key).toLowerCase();
  });
  assert.equal(actual, expected);
  await assert.rejects(withBunkerChainOwnerKey(phrase, 84532, 1, async () => { throw new Error("cancelled"); }), /cancelled/);
  assert.equal(deriveBunkerChainOwner(phrase, 84532, 1), expected);
});

const owner = vectors[2][3] as Address;
const profile = { chainId: 84532, factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as Address,
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a" as Address, proxyCreationCode: "0x60006000" as const };
const coder = AbiCoder.defaultAbiCoder();

test("deployment salt and address match the independent standard-factory calculation", () => {
  const identity = buildBunkerDeploymentIdentity(profile, owner);
  const expectedSalt = keccak256(coder.encode(["bytes32", "uint256", "uint256", "uint256", "address"],
    [keccak256(toUtf8Bytes("WalletChan.SafeBunker.shared-seed")), 2, 2, profile.chainId, owner]));
  assert.equal(identity.salt, BigInt(expectedSalt).toString());
  const standardSalt = keccak256(concat([keccak256(identity.initializer), coder.encode(["uint256"], [expectedSalt])]));
  assert.equal(identity.address, getCreate2Address(profile.factory, standardSalt,
    keccak256(concat([profile.proxyCreationCode, coder.encode(["uint256"], [profile.singleton])]))).toLowerCase());
  const factory = new Interface(["function createProxyWithNonce(address,bytes,uint256)"]);
  assert.equal(identity.deploymentData, factory.encodeFunctionData("createProxyWithNonce", [profile.singleton, identity.initializer, expectedSalt]));
});

test("initialization is exactly one owner with no optional authority or payment", () => {
  const identity = buildBunkerDeploymentIdentity(profile, owner);
  const setup = decodeFunctionData({ abi: parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  ]), data: identity.initializer });
  assert.deepEqual(setup.args, [[getAddress(owner)], 1n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress]);
});

test("reimport, casing and unrelated device metadata cannot alter deployment identity", () => {
  const firstProfile = { ...profile, groupId: "first", payer: "one", name: "One" };
  const secondProfile = { ...profile, groupId: "reimport", payer: "two", name: "Renamed" };
  const first = buildBunkerDeploymentIdentity(firstProfile, owner);
  const second = buildBunkerDeploymentIdentity(secondProfile, owner);
  assert.deepEqual(first, second);
  assert.deepEqual(buildBunkerDeploymentIdentity({ ...profile, factory: profile.factory.toLowerCase() as Address }, owner), first);
  assert.equal(first.accountId, `bunker:84532:${first.address}`);
  assert.notEqual(buildBunkerDeploymentIdentity({ ...profile, chainId: 11155111 }, owner).address, first.address);
  assert.notEqual(buildBunkerDeploymentIdentity(profile, vectors[1][3]).address, first.address);
});

test("identity rejects malformed chain, owner, infrastructure and creation code", () => {
  for (const chainId of [0, -1, NaN, Number.MAX_SAFE_INTEGER + 1, "84532"]) {
    assert.throws(() => bunkerDeploymentSalt(chainId as number, owner));
    assert.throws(() => buildBunkerDeploymentIdentity({ ...profile, chainId: chainId as number }, owner));
  }
  for (const bad of [zeroAddress, "0x01", "owner"]) {
    assert.throws(() => buildBunkerDeploymentIdentity(profile, bad as Address));
    assert.throws(() => buildBunkerDeploymentIdentity({ ...profile, factory: bad as Address }, owner));
    assert.throws(() => buildBunkerDeploymentIdentity({ ...profile, singleton: bad as Address }, owner));
  }
  for (const code of ["0x", "0x1", "0xzz", "0x" + "00".repeat(4097)]) {
    assert.throws(() => buildBunkerDeploymentIdentity({ ...profile, proxyCreationCode: code as `0x${string}` }, owner));
  }
});
