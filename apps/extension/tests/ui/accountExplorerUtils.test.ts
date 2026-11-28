import assert from "node:assert/strict";
import test from "node:test";

import {
  getAccountDashboardLinks,
  getAccountExplorerUrl,
  getDefaultAccountExplorerUrl,
} from "../../src/components/accountExplorerUtils";

const address = "0xb06a60000000000000000000000000000000dac2";

test("builds the default Etherscan account URL", () => {
  assert.equal(
    getDefaultAccountExplorerUrl(address),
    `https://etherscan.io/address/${address}`,
  );
});

test("builds the supported portfolio dashboard URLs in display order", () => {
  assert.deepEqual(getAccountDashboardLinks(address), [
    {
      name: "DeBank",
      iconSrc: "/debank-icon.ico",
      href: `https://debank.com/profile/${address}`,
    },
    {
      name: "Nansen",
      iconSrc: "/nansen-icon.png",
      href: `https://app.nansen.ai/address/${address}`,
    },
    {
      name: "Octav",
      iconSrc: "/octav-icon.png",
      href: `https://pro.octav.fi/?addresses=${address}`,
    },
    {
      name: "Zerion",
      iconSrc: "/zerion-icon.png",
      href: `https://app.zerion.io/${address}/overview`,
    },
    {
      name: "Blockscan",
      iconSrc: "/blockscan-icon.png",
      href: `https://blockscan.com/address/${address}`,
    },
  ]);
});

test("encodes dashboard address path and query input", () => {
  const links = getAccountDashboardLinks("name with spaces.eth");
  assert.ok(links.every(({ href }) => !href.includes("name with spaces.eth")));
  assert.ok(links.every(({ href }) => href.includes("name%20with%20spaces.eth")));
});


test("bound-chain account URLs use the configured explorer", () => {
  assert.equal(getDefaultAccountExplorerUrl(address, "https://sepolia.basescan.org/"),
    `https://sepolia.basescan.org/address/${address}`);
  assert.equal(getDefaultAccountExplorerUrl(address, "https://basescan.org"),
    `https://basescan.org/address/${address}`);
});


test("account picker explorer uses each Bunker's bound chain independently of selection", () => {
  const bunker = { type: "safeBunker", address, chainId: 84532 } as import("../../src/chrome/types").Account;
  assert.equal(getAccountExplorerUrl(bunker), `https://sepolia.basescan.org/address/${address}`);
  assert.equal(getAccountExplorerUrl({ ...bunker, chainId: 1 }), `https://etherscan.io/address/${address}`);
  assert.equal(getAccountExplorerUrl({ ...bunker, chainId: 8453 }), `https://basescan.org/address/${address}`);
  assert.equal(getAccountExplorerUrl({ ...bunker, chainId: 999999999 }), undefined);
  assert.equal(getAccountExplorerUrl({ type: "privateKey", address } as import("../../src/chrome/types").Account),
    `https://etherscan.io/address/${address}`);
});
