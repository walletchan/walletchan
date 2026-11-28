import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  HStack,
  VStack,
  Text,
  Button,
  Checkbox,
  Image,
} from "@chakra-ui/react";
import { TimeIcon } from "@chakra-ui/icons";
import { blo } from "blo";

import type { Account } from "@/chrome/types";
import type { CompletedTransaction } from "@/chrome/txHistoryStorage";
import { truncateAddress } from "@/lib/addressUtils";
import { useThemedToast } from "@/hooks/useThemedToast";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  ListItem,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemMeta,
  ListItemTitle,
  ListSurface,
  SkeletonRow,
} from "@/components/ui";
import { SettingsScreenFrame } from "./SettingsScreenFrame";

import { activityMessage } from "@/components/SignatureHistory/useSignatureHistory";

interface Props {
  kind: "transaction" | "signature";
  onBack: () => void;
}

function accountTypeLabel(account: Account): string {
  switch (account.type) {
    case "bankr":
      return "Bankr";
    case "privateKey":
      return "Private Key";
    case "seedPhrase":
      return `Seed · #${account.derivationIndex}`;
    case "ledger":
      return `Ledger · Account ${account.hdIndex + 1}`;
    case "trezor":
      return `Trezor · Account ${account.hdIndex + 1}`;
    case "impersonator":
      return "View-Only";
    case "safeBunker": return "Safe Bunker";
    case "safe":
      return "Safe";
  }
}

function ClearHistoryScreen({ kind, onBack }: Props) {
  const toast = useThemedToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [accounts, owners] = await Promise.all([
          chrome.runtime.sendMessage({ type: "getAccounts" }) as Promise<
            Account[]
          >,
          kind === "signature"
            ? activityMessage<{ entries: { ownerAddress: string }[] }>({
                type: "getSignatureHistory",
              }).then(({ entries }) =>
                entries.map((entry) => entry.ownerAddress),
              )
            : chrome.runtime
                .sendMessage({ type: "getTxHistory" })
                .then((history: CompletedTransaction[]) =>
                  history.map((entry) => entry.tx.from),
                ),
        ]);
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const owner of owners) {
          const address = owner.toLowerCase();
          counts.set(address, (counts.get(address) ?? 0) + 1);
        }
        setAccounts(accounts);
        setCounts(counts);
      } catch {
        if (!cancelled) setError("Could not load history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const allIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const allSelected =
    accounts.length > 0 && selectedIds.size === accounts.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const handleDelete = async () => {
    if (!confirming || submitting || !selectedIds.size) return;
    setSubmitting(true);
    const addresses = [
      ...new Set(
        accounts
          .filter((a) => selectedIds.has(a.id))
          .map((a) => a.address.toLowerCase()),
      ),
    ];
    try {
      if (kind === "signature" && !allSelected) {
        for (const ownerAddress of addresses) {
          await activityMessage({
            type: "clearSignatureHistory",
            filter: { ownerAddress },
          });
        }
      } else if (kind === "signature") {
        await activityMessage({ type: "clearSignatureHistory" });
      } else {
        await activityMessage(
          allSelected
            ? { type: "clearTxHistory" }
            : { type: "clearTxHistoryForAddresses", addresses },
        );
      }
      toast({
        title:
          kind === "signature"
            ? "Signature history cleared"
            : "Transaction history cleared",
        status: "success",
      });
      onBack();
    } catch {
      toast({ title: "Could not finish clearing history", status: "error" });
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };
  const accountScope = allSelected
    ? "all accounts"
    : `${selectedIds.size} selected account${selectedIds.size === 1 ? "" : "s"}`;

  return (
    <SettingsScreenFrame
      title={`Clear ${kind} history`}
      onBack={() => {
        if (!submitting) onBack();
      }}
      primaryAction={
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          isDisabled={selectedIds.size === 0 || loading}
          isLoading={submitting}
          loadingText="Deleting..."
        >
          {selectedIds.size > 0
            ? `Clear history for ${selectedIds.size} account${selectedIds.size === 1 ? "" : "s"}`
            : "Clear history"}
        </Button>
      }
    >
      <VStack spacing={5} align="stretch">
        {loading ? (
          <ListSurface aria-label="Loading accounts">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </ListSurface>
        ) : error ? (
          <Text role="alert">{error}</Text>
        ) : accounts.length === 0 ? (
          <EmptyState>
            <EmptyStateMedia>
              <TimeIcon boxSize={6} />
            </EmptyStateMedia>
            <EmptyStateHeader>
              <EmptyStateTitle>No accounts found</EmptyStateTitle>
              <EmptyStateDescription>
                Add an account before managing its {kind} history.
              </EmptyStateDescription>
            </EmptyStateHeader>
          </EmptyState>
        ) : (
          <ListSurface aria-label={`Accounts with ${kind} history`}>
            <ListItem density="compact" bg="surface.sunken">
              <Checkbox
                isChecked={allSelected}
                isIndeterminate={someSelected}
                onChange={toggleAll}
                flex="1"
              >
                <HStack w="full" justify="space-between" spacing={3}>
                  <Text fontSize="sm" fontWeight="600">
                    Select all accounts
                  </Text>
                  <Text
                    fontSize="xs"
                    color="fg.muted"
                    sx={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {selectedIds.size}/{accounts.length}
                  </Text>
                </HStack>
              </Checkbox>
            </ListItem>

            {accounts.map((account) => {
              const checked = selectedIds.has(account.id);
              const count = counts.get(account.address.toLowerCase()) ?? 0;
              const primary =
                account.displayName || truncateAddress(account.address);
              const showAddrLine = !!account.displayName;
              const blockieSrc = blo(account.address as `0x${string}`);

              return (
                <ListItem key={account.id} isSelected={checked}>
                  <Checkbox
                    aria-label={`Select ${primary}`}
                    isChecked={checked}
                    onChange={() => toggleOne(account.id)}
                  />
                  <ListItemMedia>
                    <Image
                      src={blockieSrc}
                      alt=""
                      w="32px"
                      h="32px"
                      minW="32px"
                      borderRadius="md"
                    />
                  </ListItemMedia>
                  <ListItemContent>
                    <ListItemTitle
                      fontFamily={account.displayName ? undefined : "mono"}
                      noOfLines={1}
                      title={`${primary} · ${account.address}`}
                    >
                      {primary}
                    </ListItemTitle>
                    <ListItemDescription noOfLines={1}>
                      {accountTypeLabel(account)}
                      {showAddrLine
                        ? ` · ${truncateAddress(account.address)}`
                        : ""}
                    </ListItemDescription>
                  </ListItemContent>
                  <ListItemMeta whiteSpace="nowrap">
                    {count}{" "}
                    {kind === "transaction"
                      ? "tx"
                      : count === 1
                        ? "signature"
                        : "signatures"}
                  </ListItemMeta>
                </ListItem>
              );
            })}
          </ListSurface>
        )}
      </VStack>
      <AlertDialog
        isOpen={confirming}
        leastDestructiveRef={cancelRef}
        onClose={() => !submitting && setConfirming(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent mx={4}>
            <AlertDialogHeader fontSize="md">
              Clear {kind} history?
            </AlertDialogHeader>
            <AlertDialogBody>
              Permanently delete local {kind} history for {accountScope}?
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button
                ref={cancelRef}
                variant="secondary"
                isDisabled={submitting}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={submitting}
                onClick={() => void handleDelete()}
              >
                Clear history
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </SettingsScreenFrame>
  );
}

export default ClearHistoryScreen;
