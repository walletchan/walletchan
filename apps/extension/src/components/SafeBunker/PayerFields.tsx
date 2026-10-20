import { Badge, Checkbox, FormControl, FormLabel, Skeleton, Text, VStack, HStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import type { Account } from "@/chrome/types";
import { DecisionAccountSelector } from "@/components/RequestConfirmation/DecisionAccountSelector";
import { usePayerBalances } from "./usePayerBalances";
import { isSafeExecutorAccount } from "@/chrome/safe/accountTypePolicy";

export function PayerFields({ value, onChange, remember, onRemember, disabled, compact = false, defaultAccountId, onAccountChange, deployment = false, chainId, bunkerAccount }: {
  bunkerAccount?: Account; chainId: number; deployment?: boolean; value: string; onChange: (id: string) => void; remember: boolean; onRemember: (value: boolean) => void; disabled?: boolean; compact?: boolean; defaultAccountId?: string; onAccountChange?: (account: Account | null) => void;
}) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { let active = true;
    void chrome.runtime.sendMessage({ type: "getAccounts" }).then((a: Account[]) => { if (active) setAccounts(a.filter(isSafeExecutorAccount)); });
    return () => { active = false; };
  }, []);
  const payerOptions = useMemo(() => bunkerAccount && !deployment ? [bunkerAccount, ...accounts] : accounts, [accounts, bunkerAccount, deployment]);
  const balances = usePayerBalances(payerOptions, chainId);
  const selected = payerOptions.find((account) => account.id === value) ?? null;
  useEffect(() => { onAccountChange?.(selected); }, [selected, onAccountChange]);
  const select = (id: string) => { setChosenId(id); onRemember(false); onChange(id); };
  const picker = <DecisionAccountSelector accounts={payerOptions} selectedAccount={selected} chainId={chainId}
    onSelect={select} label={deployment ? "Choose account" : "Choose gas payer"} disabled={disabled}
    renderBadge={account => account.id === bunkerAccount?.id
      ? <Badge variant="warning" borderRadius="full" textTransform="none" flexShrink={0}>This Bunker</Badge>
      : balances[account.id] === undefined
      ? <Skeleton w="64px" h="12px" flexShrink={0} aria-label="Loading balance" />
      : <Text fontSize="xs" color="fg.secondary" whiteSpace="nowrap" flexShrink={0} textAlign="right" sx={{ fontVariantNumeric: "tabular-nums" }} title={balances[account.id] === null ? "Balance unavailable" : undefined}>{balances[account.id] ?? "—"}</Text>} />;
  return <VStack align="stretch" spacing={compact ? 0 : 2}>
    {compact ? <HStack justify="space-between" minW={0}><Text fontSize="xs" fontWeight="600" color="fg.secondary" flexShrink={deployment ? 1 : 0} minW={0}>{deployment ? "Pay for deployment using" : "Gas payer"}</Text><VStack align="stretch" minW={0} maxW="230px">{picker}</VStack></HStack> : <FormControl><FormLabel as="p">{deployment ? "Pay for deployment using" : "Gas payer"}</FormLabel>{picker}</FormControl>}
    {!payerOptions.length && <Text color="fg.secondary" fontSize="sm">Add a private-key, seed-phrase, Ledger or Trezor account to pay gas.</Text>}
    {!deployment && (!compact || chosenId === value && value !== (defaultAccountId ?? bunkerAccount?.id)) && <Checkbox variant="commitment" sx={{ ".chakra-checkbox__control": { borderRadius: 0 } }} minH={compact ? "24px" : undefined} alignSelf={compact ? "flex-end" : undefined} size={compact ? "sm" : "md"} isChecked={remember} isDisabled={disabled} onChange={(e) => onRemember(e.target.checked)}><Text fontSize={compact ? "xs" : "sm"} color="fg.secondary" lineHeight="short">{compact ? "set default payer for future" : "Use as default for this Bunker"}</Text></Checkbox>}
  </VStack>;
}
