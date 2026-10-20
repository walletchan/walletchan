import { readFile, mkdir, writeFile } from "node:fs/promises";
import { keccak256, type Hex } from "viem";
const pins = JSON.parse(await readFile("src/chrome/safeBunker/deployments.json", "utf8"));
await mkdir("tests/safeBunker/fixtures", { recursive: true });
for (const name of ["factory", "singleton", "multiSend", "Safe4337Module", "SafeModuleSetup", "EntryPoint"]) {
  const pin = pins[({ Safe4337Module: "module", SafeModuleSetup: "moduleSetup", EntryPoint: "entryPoint" } as Record<string, string>)[name] ?? name];
  const response = await fetch("https://ethereum-sepolia-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [pin.address, "latest"] }), signal: AbortSignal.timeout(15000) });
  const { result } = await response.json() as { result: Hex };
  if (!result || keccak256(result) !== pin.codeHash) throw new Error(`Pinned Safe ${name} runtime mismatch`);
  await writeFile(`tests/safeBunker/fixtures/${name}.json`, JSON.stringify({ ...pin, runtime: result }) + "\n");
  console.log(`Verified canonical Safe ${name}`);
}
