import { useEffect, useState } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronRightIcon } from "@chakra-ui/icons";
import type { Account, SafeBunkerAccount } from "@/chrome/types";
import { BUNKER_REVERT_WARNINGS_KEY, readBunkerRevertWarnings } from "@/chrome/safeBunker/revertWarning";

/** Matches the backup reminder; storage contains account IDs only, never signed intent. */
export function HomeBunkerRevertWarning({ account, onRotate }: {
  account: Account | null; onRotate: (account: SafeBunkerAccount) => void;
}) {
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let disposed = false, revision = 0;
    const refresh = async () => {
      const request = ++revision;
      try {
        const next = await readBunkerRevertWarnings();
        if (!disposed && request === revision) setWarnings(next);
      } catch { /* Preserve the last warning if a read fails. */ }
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[BUNKER_REVERT_WARNINGS_KEY]) void refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    void refresh();
    return () => { disposed = true; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  if (account?.type !== "safeBunker" || !warnings.includes(account.id)) return null;
  return <Box data-bunker-revert-warning as="button" type="button" w="full" textAlign="left" px={3} py={2} minH="52px"
    appearance="none" cursor="pointer" fontFamily="inherit" color="fg.inverse"
    bg="status.error.emphasis" border="1px solid" borderColor="status.error.emphasis" borderRadius="lg"
    _hover={{ opacity: 0.92 }} _active={{ opacity: 0.84 }}
    _focusVisible={{ outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" }} onClick={() => onRotate(account)}>
    <HStack justify="space-between" spacing={3}>
      <Text fontWeight="700" fontSize="sm">Last Tx reverted, Rotate owner</Text>
      <ChevronRightIcon boxSize={4} aria-hidden="true" />
    </HStack>
  </Box>;
}
