import { Button, Flex } from "@chakra-ui/react";
import { AddIcon } from "@chakra-ui/icons";
import { SeedIcon } from "@/components/shared/AccountTypeIcons";
import {
  ListItem,
  ListItemActions,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemTitle,
  ListSurface,
  ScreenSection,
} from "@/components/ui";

export interface SeedGroupSummary {
  id: string;
  name: string;
  accountCount: number;
}

interface SeedPhraseAccountSectionProps {
  groups: SeedGroupSummary[];
  isAuthenticating: boolean;
  onDerive: (groupId: string) => void;
}

export function SeedPhraseAccountSection({
  groups,
  isAuthenticating,
  onDerive,
}: SeedPhraseAccountSectionProps) {
  return (
    <ScreenSection
      title="Saved seed phrases"
      headingProps={{ fontSize: "sm", fontWeight: 600, color: "fg.secondary" }}
    >
      <ListSurface borderColor="border.subtle">
        {groups.map((group) => (
          <ListItem key={group.id}>
            <ListItemMedia>
              <Flex
                boxSize="36px"
                align="center"
                justify="center"
                borderRadius="md"
                bg="status.info.bg"
                color="status.info.fg"
              >
                <SeedIcon boxSize="19px" />
              </Flex>
            </ListItemMedia>
            <ListItemContent>
              <ListItemTitle noOfLines={1}>{group.name}</ListItemTitle>
              <ListItemDescription>
                {group.accountCount}{" "}
                {group.accountCount === 1 ? "account" : "accounts"}
              </ListItemDescription>
            </ListItemContent>
            <ListItemActions>
              <Button
                size="sm"
                variant="ghost"
                color="accent.secondary"
                minH="44px"
                px={3}
                _hover={{ bg: "surface.raisedHover" }}
                leftIcon={<AddIcon boxSize={3} />}
                isDisabled={isAuthenticating}
                onClick={() => onDerive(group.id)}
              >
                Add
              </Button>
            </ListItemActions>
          </ListItem>
        ))}
      </ListSurface>
    </ScreenSection>
  );
}
