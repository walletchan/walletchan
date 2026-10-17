import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { ScreenSection } from "@/components/ui";
import { HardwareWalletLogo } from "./HardwareWalletLogo";
import type { HardwareWalletBrand } from "./types";

export interface HardwareWalletDevicePanelProps {
  brand: HardwareWalletBrand;
  showHeading?: boolean;
  device: {
    deviceLabel: string;
  } | null;
  busy: boolean;
  status: string;
  connectedDescription: string;
  readyStatusDescription: string;
  disconnectedDescription: string;
  disconnectedStatusDescription: string;
}

export function HardwareWalletDevicePanel({
  brand,
  showHeading = true,
  device,
  busy,
  status,
  connectedDescription,
  readyStatusDescription,
  disconnectedDescription,
  disconnectedStatusDescription,
}: HardwareWalletDevicePanelProps) {
  return (
    <ScreenSection
      title={showHeading ? "Hardware wallet" : undefined}
      description={showHeading ? (device ? connectedDescription : disconnectedDescription) : undefined}
    >
      <Box
        p={4}
        bg="surface.raised"
        border="1px solid"
        borderColor="border.subtle"
        borderRadius="lg"
      >
        <HStack justify="space-between" align="center" spacing={4}>
          <HardwareWalletLogo brand={brand} w="108px" />
          <HStack spacing={2} flexShrink={0}>
            {busy && <Spinner size="xs" color="accent.highlight" />}
            {device && (
              <HStack
                spacing={1.5}
                px={2.5}
                py={1}
                bg="status.success.bg"
                border="1px solid"
                borderColor="status.success.border"
                borderRadius="full"
              >
                <Box boxSize="6px" borderRadius="full" bg="status.success.fg" />
                <Text
                  color="status.success.fg"
                  fontSize="xs"
                  fontWeight="600"
                >
                  Connected
                </Text>
              </HStack>
            )}
          </HStack>
        </HStack>

        <Box mt={4} pt={4} borderTop="1px solid" borderColor="border.subtle">
          <Text color="fg.primary" fontSize="lg" fontWeight="700">
            {device?.deviceLabel || status}
          </Text>
          <Text mt={1} color="fg.secondary" fontSize="sm">
            {device
              ? busy
                ? status
                : readyStatusDescription
              : disconnectedStatusDescription}
          </Text>
        </Box>
      </Box>
    </ScreenSection>
  );
}
