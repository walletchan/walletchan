import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveBunkerChainOwner } from "../../src/chrome/safeBunker/chainOwnerDerivation";
import { BUNKER_FACTORY_ABI, buildBunkerDeploymentIdentity } from "../../src/chrome/safeBunker/deploymentIdentity";

const phrase = `${"abandon ".repeat(11)}about`;
// Default Anvil test key; funds exist only inside these disposable local nodes.
const payer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const SAFE_ABI = parseAbi([
  "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)",
  "function nonce() view returns(uint256)", "function masterCopy() view returns(address)",
]);
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test("shared phrase predicts and deploys distinct standard Safes on two independent chains", { timeout: 30000 }, async t => {
  const fixtures = await Promise.all(["factory", "singleton"].map(async name =>
    JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as
      { address: Address; runtime: Hex; codeHash: Hex }));
  const [factory, singleton] = fixtures;
  const results: Array<{ owner: Address; address: Address }> = [];
  for (const chainId of [11155111, 84532]) {
    await t.test(`standard-factory deployment on disposable chain ${chainId}`, async () => {
      const port = await freePort();
      const node = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", String(chainId), "--silent"], { stdio: "ignore" });
      let processError: Error | undefined;
      node.on("error", error => { processError = error; });
      const chain = defineChain({ id: chainId, name: "Disposable Bunker test chain",
        nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } });
      const client = createPublicClient({ chain, cacheTime: 0, transport: http(chain.rpcUrls.default.http[0], { retryCount: 0, timeout: 1000 }) });
      const wallet = createWalletClient({ chain, account: payer, transport: http(chain.rpcUrls.default.http[0]) });
      try {
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          if (processError) throw processError;
          try { assert.equal(await client.getChainId(), chainId); ready = true; break; }
          catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        assert.ok(ready, "disposable node started");
        for (const fixture of fixtures) {
          assert.equal(keccak256(fixture.runtime), fixture.codeHash);
          await client.request({ method: "anvil_setCode" as never, params: [fixture.address, fixture.runtime] as never });
        }
        const code = await client.readContract({ address: factory.address, abi: BUNKER_FACTORY_ABI, functionName: "proxyCreationCode" });
        const owner = deriveBunkerChainOwner(phrase, chainId, 0);
        const profile = { chainId, factory: factory.address, singleton: singleton.address, proxyCreationCode: code };
        const identity = buildBunkerDeploymentIdentity(profile, owner);
        assert.equal(await client.getCode({ address: identity.address }), undefined);
        const simulated = await client.simulateContract({ address: factory.address, abi: BUNKER_FACTORY_ABI,
          functionName: "createProxyWithNonce", args: [singleton.address, identity.initializer, BigInt(identity.salt)], account: payer });
        assert.equal(simulated.result.toLowerCase(), identity.address);
        const hash = await wallet.sendTransaction({ to: factory.address, data: identity.deploymentData });
        const receipt = await client.waitForTransactionReceipt({ hash });
        assert.equal(receipt.status, "success");
        assert.equal(keccak256((await client.getCode({ address: identity.address }))!),
          "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c");
        assert.deepEqual((await client.readContract({ address: identity.address, abi: SAFE_ABI, functionName: "getOwners" })).map(a => a.toLowerCase()), [owner]);
        assert.equal(await client.readContract({ address: identity.address, abi: SAFE_ABI, functionName: "getThreshold" }), 1n);
        assert.equal(await client.readContract({ address: identity.address, abi: SAFE_ABI, functionName: "nonce" }), 0n);
        assert.equal((await client.readContract({ address: identity.address, abi: SAFE_ABI, functionName: "masterCopy" })).toLowerCase(), singleton.address.toLowerCase());
        assert.equal(buildBunkerDeploymentIdentity(profile, deriveBunkerChainOwner(phrase, chainId, 0)).address, identity.address);
        await assert.rejects(client.simulateContract({ address: factory.address, abi: BUNKER_FACTORY_ABI,
          functionName: "createProxyWithNonce", args: [singleton.address, identity.initializer, BigInt(identity.salt)], account: payer }));
        results.push({ owner, address: identity.address });
      } finally {
        if (node.exitCode === null && node.signalCode === null && !processError) {
          const exited = new Promise<void>(resolve => node.once("exit", () => resolve()));
          node.kill("SIGTERM");
          await exited;
        }
      }
    });
  }
  assert.equal(results.length, 2);
  assert.notEqual(results[0].owner, results[1].owner);
  assert.notEqual(results[0].address, results[1].address);
});
