import { Checkbox, FormControl, FormLabel, Text, VStack, HStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import type { Account } from "@/chrome/types";
import { SafeOwnerAccountPicker } from "@/components/SafeAccount/SafeOwnerAccountPicker";
import { DecisionAccountSelector } from "@/components/RequestConfirmation/DecisionAccountSelector";
import { isSafeExecutorAccount } from "@/chrome/safe/accountTypePolicy";

export function PayerFields({ value, onChange, remember, onRemember, disabled, compact = false, defaultAccountId, onAccountChange, deployment = false }: {
  deployment?: boolean; value: string; onChange: (id: string) => void; remember: boolean; onRemember: (value: boolean) => void; disabled?: boolean; compact?: boolean; defaultAccountId?: string; onAccountChange?: (account: Account | null) => void;
}) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { let active = true;
    void chrome.runtime.sendMessage({ type: "getAccounts" }).then((a: Account[]) => { if (active) setAccounts(a.filter(isSafeExecutorAccount)); });
    return () => { active = false; };
  }, []);
  const selected = accounts.find((account) => account.id === value) ?? null;
  useEffect(() => { onAccountChange?.(selected); }, [selected, onAccountChange]);
  const select = (id: string) => { setChosenId(id); onRemember(false); onChange(id); };
  const picker = compact || deployment ? <DecisionAccountSelector accounts={accounts} selectedAccount={selected} chainId={11155111}
    onSelect={select} label={deployment ? "Choose account" : "Choose gas payer"} disabled={disabled} /> : <SafeOwnerAccountPicker accounts={accounts} selectedAccountId={value || null} onSelect={select}
    title="Choose gas payer" changeLabel="Change gas payer" backLabel="Back to transaction" description="" disabled={disabled} compact={compact} />;
  return <VStack align="stretch" spacing={compact ? 0 : 2}>
    {compact ? <HStack justify="space-between" minW={0}><Text fontSize="xs" fontWeight="600" color="fg.secondary" flexShrink={deployment ? 1 : 0} minW={0}>{deployment ? "Pay for deployment using" : "Gas payer"}</Text><VStack align="stretch" minW={0} maxW="230px">{picker}</VStack></HStack> : <FormControl><FormLabel as="p">{deployment ? "Pay for deployment using" : "Gas payer"}</FormLabel>{picker}</FormControl>}
    {!accounts.length && <Text color="fg.secondary" fontSize="sm">Add a private-key, seed-phrase or Ledger account to pay gas.</Text>}
    {!deployment && (!compact || chosenId === value && value !== defaultAccountId) && <Checkbox variant="commitment" minH={compact ? "24px" : undefined} alignSelf={compact ? "flex-end" : undefined} size={compact ? "sm" : "md"} isChecked={remember} isDisabled={disabled} onChange={(e) => onRemember(e.target.checked)}><Text fontSize={compact ? "xs" : "sm"} color="fg.secondary" lineHeight="short">{compact ? "set default payer for future" : "Use as default for this Bunker"}</Text></Checkbox>}
  </VStack>;
}
