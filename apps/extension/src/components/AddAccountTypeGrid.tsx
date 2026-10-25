import {
  Button,
  Flex,
  Image,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  EyeIcon,
  KeyIcon,
  SeedIcon,
  SafeIcon,
} from "@/components/shared/AccountTypeIcons";
import { LedgerLogo } from "@/components/Ledger/LedgerLogo";
import { TrezorLogo } from "@/components/Trezor/TrezorLogo";
import { HardwareWalletLogo } from "@/components/HardwareWallet/HardwareWalletLogo";
import { KEYCARD_SHELL_HARDWARE_WALLET_BRAND } from "@/components/KeycardShell/keycardShellBrand";
import { TREZOR_BUILD_ENABLED } from "@/app/buildFeatures";

export type AccountType =
  | "bankr"
  | "privateKey"
  | "seedPhrase"
  | "ledger"
  | "trezor"
  | "keycard-shell"
  | "impersonator"
  | "safe";

interface AddAccountTypeGridProps {
  hasBankrAccount: boolean;
  onSelect: (type: AccountType) => void;
}

const accountTypes = [
  {
    type: "seedPhrase" as const,
    title: "Seed phrase",
    icon: SeedIcon,
    iconBg: "status.info.bg",
    iconColor: "status.info.fg",
  },
  {
    type: "privateKey" as const,
    title: "Private key",
    icon: KeyIcon,
    iconBg: "status.warning.bg",
    iconColor: "status.warning.fg",
  },
  {
    type: "impersonator" as const,
    title: "View-only",
    icon: EyeIcon,
    iconBg: "status.success.bg",
    iconColor: "status.success.fg",
  },
  {
    type: "ledger" as const,
    title: "Ledger",
    icon: null,
    iconBg: "surface.sunken",
    iconColor: "fg.primary",
  },
  {
    type: "trezor" as const,
    title: "Trezor",
    icon: null,
    iconBg: "surface.sunken",
    iconColor: "fg.primary",
  },
  {
    type: "keycard-shell" as const,
    title: "Keycard Shell",
    icon: null,
    iconBg: "surface.sunken",
    iconColor: "fg.primary",
  },
  {
    type: "safe" as const,
    title: "Safe",
    icon: SafeIcon,
    iconBg: "status.success.bg",
    iconColor: "status.success.fg",
  },
  {
    type: "bankr" as const,
    title: "Bankr API",
    icon: null,
    iconBg: "transparent",
    iconColor: "fg.primary",
  },
];

export function AddAccountTypeGrid({
  hasBankrAccount,
  onSelect,
}: AddAccountTypeGridProps) {
  const ledgerUnavailable =
    typeof navigator === "undefined" || !("hid" in navigator);
  const trezorUnavailable =
    typeof chrome === "undefined" ||
    !chrome.offscreen ||
    !chrome.runtime?.getContexts;
  return (
    <SimpleGrid columns={2} spacing={3}>
      {accountTypes
        .filter(({ type }) => type !== "trezor" || TREZOR_BUILD_ENABLED)
        .map(
        ({
          type,
          title,
          icon: TypeIcon,
          iconBg,
          iconColor,
        }) => {
        const isDisabled =
          (type === "bankr" && hasBankrAccount) ||
          ((type === "ledger" || type === "keycard-shell") && ledgerUnavailable) ||
          (type === "trezor" && trezorUnavailable);

        return (
          <Button
            key={type}
            variant="secondary"
            minH={0}
            h="auto"
            p={4}
            alignItems="stretch"
            justifyContent="space-between"
            whiteSpace="normal"
            textAlign="left"
            isDisabled={isDisabled}
            onClick={() => onSelect(type)}
            _hover={{
              bg: "surface.raisedHover",
              borderColor: "accent.highlight",
            }}
          >
            <VStack align="stretch" spacing={4} w="full">
              <Flex
                boxSize="36px"
                align="center"
                justify="center"
                borderRadius="md"
                bg={iconBg}
                color={iconColor}
              >
                {type === "ledger" ? (
                  <LedgerLogo variant="lettermark" w="20px" />
                ) : type === "keycard-shell" ? (
                  <HardwareWalletLogo brand={KEYCARD_SHELL_HARDWARE_WALLET_BRAND} variant="lettermark" w="20px" aria-hidden />
                ) : type === "trezor" ? (
                  <TrezorLogo variant="lettermark" h="22px" />
                ) : TypeIcon ? (
                  <TypeIcon boxSize="19px" />
                ) : (
                  <Image
                    src="/bankr-icon.png"
                    alt="Bankr"
                    boxSize="36px"
                    borderRadius="md"
                  />
                )}
              </Flex>
              <VStack align="stretch" spacing={0.5}>
                <Text color="fg.primary" fontSize="md" fontWeight="600">
                  {title}
                </Text>
                {isDisabled && (
                  <Text color="fg.secondary" fontSize="sm" fontWeight="400">
                    {type === "bankr" ? "Already connected" : "Chrome 124+ required"}
                  </Text>
                )}
              </VStack>
            </VStack>
          </Button>
        );
        },
      )}
    </SimpleGrid>
  );
}
