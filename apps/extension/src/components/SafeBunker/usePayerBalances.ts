import { useEffect, useState } from "react";
import { createPublicClient } from "viem";
import type { Account } from "@/chrome/types";
import { secureHttpTransport } from "@/chrome/network/rpcClient";
import { getStoredResolvedChainById } from "@/lib/chains";
import { formatTokenAmountFromBase } from "@/lib/tokenFormatUtils";

type Balances = Record<string, string | null>;
/** Display-only, chain-bound native balances; RPC failures are never shown as zero. */
export function usePayerBalances(accounts: readonly Account[], chainId: number): Balances {
  const [snapshot, setSnapshot] = useState<{ chainId: number; balances: Balances }>({ chainId: 0, balances: {} });
  useEffect(() => {
    if (!chainId || !accounts.length) return;
    let active = true;
    setSnapshot({ chainId, balances: {} });
    const publish = (id: string, label: string | null) => {
      if (active) setSnapshot(old => ({ chainId, balances: { ...old.balances, [id]: label } }));
    };
    void (async () => {
      try {
        const network = await getStoredResolvedChainById(chainId);
        if (!active) return;
        if (!network?.rpcUrl) throw new Error("Network unavailable");
        const client = createPublicClient({ transport: secureHttpTransport(network.rpcUrl, { timeout: 8000, retryCount: 0 }) });
        if (await client.getChainId() !== chainId) throw new Error("Network mismatch");
        let cursor = 0;
        const worker = async () => {
          while (active && cursor < accounts.length) {
            const account = accounts[cursor++];
            try {
              const balance = await client.getBalance({ address: account.address as `0x${string}` });
              publish(account.id, `${formatTokenAmountFromBase(balance.toString(), network.nativeCurrency.decimals)} ${network.nativeCurrency.symbol}`);
            } catch { publish(account.id, null); }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } catch { for (const account of accounts) publish(account.id, null); }
    })();
    return () => { active = false; };
  }, [accounts, chainId]);
  return snapshot.chainId === chainId ? snapshot.balances : {};
}
