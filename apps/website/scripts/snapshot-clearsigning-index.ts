/**
 * Refresh the committed offline fallback using the same atomic builder as the API.
 * Live coverage refreshes automatically; run this only to update the fallback.
 * Run from the repo root: pnpm --filter @walletchan/website exec tsx scripts/snapshot-clearsigning-index.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshRegistrySnapshot } from "../lib/clearSigningRegistry";

async function main() {
  const snapshot = await refreshRegistrySnapshot();
  const outPath = fileURLToPath(new URL("../data/clearsigning-index.json", import.meta.url));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  const addresses = Object.values(snapshot.entries).reduce((sum, chain) => sum + Object.keys(chain).length, 0);
  console.log(`Wrote ${addresses} addresses across ${Object.keys(snapshot.entries).length} chains to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
