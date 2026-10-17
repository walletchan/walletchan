import { VStack } from "@chakra-ui/react";
import { SeedPhraseAccountSection, type SeedGroupSummary } from "./SeedPhraseAccountSection";
import { AddAccountTypeGrid, type AccountType } from "@/components/AddAccountTypeGrid";
import { AppHeader, AppScreen, ScreenBody, ScreenSection } from "@/components/ui";

interface AddAccountTypeSelectionScreenProps {
  hasBankrAccount: boolean;
  seedGroups: SeedGroupSummary[];
  isAuthenticating: boolean;
  onDerive: (groupId: string) => void;
  onBack: () => void;
  onSelect: (type: AccountType) => void;
}

export function AddAccountTypeSelectionScreen({
  hasBankrAccount,
  seedGroups,
  isAuthenticating,
  onDerive,
  onBack,
  onSelect,
}: AddAccountTypeSelectionScreenProps) {
  return (
    <AppScreen>
      <AppHeader title="Add account" onBack={onBack} />
      <ScreenBody pt={5}>
        <VStack spacing={6} align="stretch">
          {seedGroups.length > 0 && (
            <SeedPhraseAccountSection
              groups={seedGroups}
              isAuthenticating={isAuthenticating}
              onDerive={onDerive}
            />
          )}
          <ScreenSection
            title="Add new account"
            headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.secondary" }}
          >
            <AddAccountTypeGrid
              hasBankrAccount={hasBankrAccount}
              onSelect={onSelect}
            />
          </ScreenSection>
        </VStack>
      </ScreenBody>
    </AppScreen>
  );
}
