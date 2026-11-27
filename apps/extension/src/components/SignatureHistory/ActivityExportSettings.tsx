import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Select,
  Text,
  VStack,
} from "@chakra-ui/react";
import { DownloadIcon } from "@chakra-ui/icons";
import { useEffect, useState } from "react";
import type { Account } from "@/chrome/types";
import AccountSwitcher from "@/components/AccountSwitcher";
import { SettingsScreenFrame } from "@/components/Settings/SettingsScreenFrame";
import { useThemedToast } from "@/hooks/useThemedToast";
import { activityMessage, useSignatureHistory } from "./useSignatureHistory";

export default function ActivityExportSettings({
  onBack,
}: {
  onBack: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ownerAddress, setOwnerAddress] = useState("");
  const [customDates, setCustomDates] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filter = {
    ownerAddress: ownerAddress || undefined,
    from:
      customDates && from ? new Date(`${from}T00:00:00`).getTime() : undefined,
    to:
      customDates && to ? new Date(`${to}T23:59:59.999`).getTime() : undefined,
  };
  const {
    entries,
    transactionCount,
    loading,
    error: historyError,
    refresh,
  } = useSignatureHistory(
    filter.ownerAddress,
    undefined,
    true,
    filter.from,
    filter.to,
  );
  const toast = useThemedToast();
  useEffect(() => {
    let active = true;
    void chrome.runtime
      .sendMessage({ type: "getAccounts" })
      .then((response) => {
        if (active)
          setAccounts(
            Array.isArray(response?.accounts)
              ? response.accounts
              : Array.isArray(response)
                ? response
                : [],
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const exportJson = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await activityMessage({ type: "exportActivity", filter });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `walletchan-activity-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: "Activity export downloaded",
        status: "success",
        duration: 2500,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not export activity",
      );
    } finally {
      setBusy(false);
    }
  };
  const uniqueAccounts = accounts.filter(
    (account, index) =>
      accounts.findIndex(
        (candidate) =>
          candidate.address.toLowerCase() === account.address.toLowerCase(),
      ) === index,
  );
  return (
    <SettingsScreenFrame
      title="Activity history"
      onBack={onBack}
      primaryAction={
        <Button
          variant="brand"
          leftIcon={<DownloadIcon />}
          onClick={() => void exportJson()}
          isLoading={busy}
          isDisabled={loading || !!historyError}
        >
          Export JSON
        </Button>
      }
    >
      <VStack align="stretch" spacing={5}>
        <Box>
          <Text fontSize="sm" fontWeight="600" color="fg.secondary" mb={2}>
            Account
          </Text>
          <Box
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            overflow="hidden"
          >
            <AccountSwitcher
              accounts={uniqueAccounts}
              activeAccount={
                uniqueAccounts.find(
                  (account) => account.address.toLowerCase() === ownerAddress,
                ) ?? null
              }
              explorerChains={[]}
              disabled={busy}
              onAccountSelect={(account) =>
                setOwnerAddress(account.address.toLowerCase())
              }
              onSelectAll={() => setOwnerAddress("")}
            />
          </Box>
        </Box>
        <FormControl>
          <FormLabel fontSize="sm">Date range</FormLabel>
          <Select
            value={customDates ? "custom" : "all"}
            onChange={(event) =>
              setCustomDates(event.target.value === "custom")
            }
            isDisabled={busy}
          >
            <option value="all">All time</option>
            <option value="custom">Custom range</option>
          </Select>
        </FormControl>
        {customDates && (
          <HStack spacing={3} align="start">
            <FormControl minW={0}>
              <FormLabel fontSize="sm">From</FormLabel>
              <Input
                minW={0}
                w="full"
                aria-label="From date"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                isDisabled={busy}
              />
            </FormControl>
            <FormControl minW={0}>
              <FormLabel fontSize="sm">Through</FormLabel>
              <Input
                minW={0}
                w="full"
                aria-label="Through date"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                isDisabled={busy}
              />
            </FormControl>
          </HStack>
        )}
        <HStack
          justify="space-between"
          align="baseline"
          spacing={2}
          borderTopWidth="1px"
          borderColor="border.subtle"
          pt={3}
        >
          <Text fontSize="sm" fontWeight="600">
            {loading || historyError || transactionCount === undefined
              ? "Transactions"
              : `${transactionCount.toLocaleString()} transaction${transactionCount === 1 ? "" : "s"}`}
          </Text>
          <Text fontSize="sm" fontWeight="600" textAlign="right">
            {loading || historyError
              ? "Saved signatures"
              : `${entries.length.toLocaleString()} saved signature${entries.length === 1 ? "" : "s"}`}
          </Text>
        </HStack>
        {(error || historyError) && (
          <Text role="alert" fontSize="sm" color="status.error.emphasis">
            {error || historyError}
          </Text>
        )}
        {historyError && (
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        )}
      </VStack>
    </SettingsScreenFrame>
  );
}
