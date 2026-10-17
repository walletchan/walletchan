import { useMemo, useState } from "react";
import { Button, FormControl, FormLabel, Input, Text, VStack } from "@chakra-ui/react";
import { formatCompactFee } from "@/lib/gasFormatUtils";
import { GasFeePopover } from "@/components/GasEstimate/GasFeePopover";
import GasTierPicker from "@/components/GasTierPicker";
import type { GasOverrides } from "@/chrome/transactions/localExecution";
import type { GasTierSelection } from "@/lib/gasTiers";

export function BunkerGasFields({ value, onChange, disabled, compact = false }: { value: GasOverrides; onChange: (gas: GasOverrides) => void; disabled?: boolean; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [base] = useState(value);
  const [tier, setTier] = useState<GasTierSelection>("standard");
  const tiers = useMemo(() => ({
    slow: { maxFeePerGas: (BigInt(base.maxFeePerGas) - BigInt(base.maxPriorityFeePerGas) / 2n).toString(), maxPriorityFeePerGas: (BigInt(base.maxPriorityFeePerGas) / 2n).toString() },
    standard: { maxFeePerGas: base.maxFeePerGas, maxPriorityFeePerGas: base.maxPriorityFeePerGas },
    fast: { maxFeePerGas: ((BigInt(/^[0-9]{1,20}$/.test(base.maxFeePerGas) ? base.maxFeePerGas : "0")) * 3n / 2n).toString(), maxPriorityFeePerGas: ((BigInt(/^[0-9]{1,20}$/.test(base.maxPriorityFeePerGas) ? base.maxPriorityFeePerGas : "0")) * 3n / 2n).toString() },
  }), [base]);
  const valid = Object.values(value).every((s) => /^(0|[1-9][0-9]{0,20})$/.test(s));
  const changeTier = (next: GasTierSelection) => { setTier(next); if (next !== "custom") { onChange({ ...value, ...tiers[next] }); setExpanded(false); } };
  const custom = <VStack align="stretch" spacing={3}>
    {([['gasLimit', 'Gas limit'], ['maxFeePerGas', 'Max fee (wei)'], ['maxPriorityFeePerGas', 'Priority fee (wei)']] as const).map(([key, label]) =>
      <FormControl key={key}><FormLabel>{label}</FormLabel><Input inputMode="numeric" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} /></FormControl>)}
    <Button size="sm" variant="secondary" onClick={() => { setTier("standard"); }}>Back to presets</Button>
  </VStack>;
  const fee = valid ? formatCompactFee((BigInt(value.gasLimit) * BigInt(value.maxFeePerGas)).toString(), "ETH") : "—";
  if (compact) return <GasFeePopover expanded={expanded} onToggle={() => setExpanded((open) => !open)} onClose={() => setExpanded(false)}
    fiatFee={null} nativeFee={fee} tier={tier} showPicker customEditorOpen={tier === "custom"} customEditor={custom}
    fallbackContent={null} tiers={tiers} gasLimit={valid ? BigInt(value.gasLimit) : null} nativePriceUsd={null}
    nativeCurrencySymbol="ETH" selectedTier={tier} onTierChange={changeTier} isDisabled={disabled} />;
  return <VStack align="stretch" spacing={3} opacity={disabled ? 0.7 : 1} pointerEvents={disabled ? "none" : undefined}>
    <GasTierPicker tiers={tiers} gasLimit={valid ? BigInt(value.gasLimit) : null} nativePriceUsd={null} nativeCurrencySymbol="ETH" selected={tier} onChange={changeTier} />
    {tier === "custom" && custom}
    <Text color="fg.secondary" fontSize="sm">Max gas fee: {fee}</Text>
  </VStack>;
}
