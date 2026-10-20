import { HomeBunkerRevertWarning } from "./HomeBunkerRevertWarning";
import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronRightIcon } from "@chakra-ui/icons";
import type { Account, SafeBunkerAccount, SeedPhraseAccount } from "@/chrome/types";
import { useSeedBackupState } from "@/components/SeedBackup/useSeedBackupState";

export function HomeBackupReminder({ accounts, onBackup, onBackupGroup }: {
  accounts: Account[];
  onBackup: (account: SeedPhraseAccount | SafeBunkerAccount) => void;
  onBackupGroup: (seedGroupId: string) => void;
}) {
  const { groups, error } = useSeedBackupState();
  const account = accounts.find((candidate): candidate is SeedPhraseAccount | SafeBunkerAccount =>
    (candidate.type === "safeBunker" || candidate.type === "seedPhrase") && groups.some((group) => group.id === candidate.seedGroupId && group.backupPending === true),
  );
  const orphan = groups.find(group => group.backupPending === true);
  if (!account && !orphan) return error ? <Text role="alert" color="status.error.emphasis" fontSize="sm">{error}. Reopen the wallet to retry.</Text> : null;
  return <Box as="button" type="button" w="full" textAlign="left" px={3} py={2} minH="52px"
    appearance="none" cursor="pointer" fontFamily="inherit" color="accentFg.highlight"
    bg="accent.highlight" border="1px solid" borderColor="accent.highlight" borderRadius="lg"
    _hover={{ opacity: 0.92 }} _active={{ opacity: 0.84 }}
    _focusVisible={{ outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" }} onClick={() => account ? onBackup(account) : orphan && onBackupGroup(orphan.id)}>
    <HStack justify="space-between" spacing={3}>
      <Text fontWeight="700" fontSize="sm">Back up your wallet</Text>
      <ChevronRightIcon boxSize={4} aria-hidden="true" />
    </HStack>
  </Box>;
}

/** Home composes both account reminders; navigation stays in App. */
export function HomeAccountReminders({ account, onRotate, ...backupProps }: Parameters<typeof HomeBackupReminder>[0] & {
  account: Account | null; onRotate: (account: SafeBunkerAccount) => void;
}) {
  return <><HomeBunkerRevertWarning account={account} onRotate={onRotate} /><HomeBackupReminder {...backupProps} /></>;
}
