import { ChevronDownIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, Menu, MenuButton, MenuItem, MenuList, Portal } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FromAccountDisplay } from "@/components/FromAccountDisplay";

type DecisionAccount = { id: string; address: string };

/** Shared compact identity and anchored account menu for decision footers. */
export function DecisionAccountSelector({ accounts, selectedAccount, chainId, onSelect, label, disabled, renderBadge }: {
  accounts: readonly DecisionAccount[]; selectedAccount: DecisionAccount | null; chainId: number;
  onSelect: (id: string) => void; label: string; disabled?: boolean;
  renderBadge?: (account: DecisionAccount) => ReactNode;
}) {
  if (selectedAccount && accounts.length === 1) return <FromAccountDisplay chainId={chainId} address={selectedAccount.address} />;
  return <Menu placement="top-end" isLazy autoSelect={false}>
    <MenuButton as={Button} variant="ghost" size="sm" minH="36px" h="auto" maxW="230px" minW={0} px={2}
      rightIcon={<ChevronDownIcon boxSize={4} />} _hover={{ bg: "surface.raisedHover" }} isDisabled={disabled || !accounts.length} aria-label={label}>
      {selectedAccount ? <FromAccountDisplay chainId={chainId} address={selectedAccount.address} /> : "Choose account"}
    </MenuButton>
    <Portal><MenuList minW="260px" maxW="calc(100vw - 32px)" maxH="320px" overflowY="auto" overscrollBehavior="contain">
      {accounts.map((account) => <MenuItem key={account.id} minH="48px" onClick={() => onSelect(account.id)}
        aria-current={account.id === selectedAccount?.id ? "true" : undefined}>
        <HStack w="full" minW={0} justify="space-between" spacing={3}>
          <Box flex={1} minW={0} overflow="hidden"><FromAccountDisplay chainId={chainId} address={account.address} /></Box>{renderBadge?.(account)}
        </HStack>
      </MenuItem>)}
    </MenuList></Portal>
  </Menu>;
}
