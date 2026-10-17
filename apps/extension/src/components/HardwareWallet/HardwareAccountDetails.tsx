import { useEffect, useState } from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";

import type { LedgerAccount, TrezorAccount } from "@/chrome/types";
import {
  ListItem,
  ListItemContent,
  ListItemDescription,
  ListItemTitle,
  ListSurface,
  ScreenSection,
} from "@/components/ui";

interface StoredHardwareDevice {
  label: string;
  model: string;
}

interface HardwareAccountDetailsProps {
  account: LedgerAccount | TrezorAccount;
}

export default function HardwareAccountDetails({
  account,
}: HardwareAccountDetailsProps) {
  const [device, setDevice] = useState<StoredHardwareDevice | null>(null);

  useEffect(() => {
    let active = true;
    const messageType =
      account.type === "ledger" ? "getLedgerDevices" : "getTrezorDevices";
    void chrome.runtime
      .sendMessage({ type: messageType })
      .then((devices: Record<string, StoredHardwareDevice> | undefined) => {
        if (active) setDevice(devices?.[account.deviceId] ?? null);
      })
      .catch(() => {
        if (active) setDevice(null);
      });
    return () => {
      active = false;
    };
  }, [account.deviceId, account.type]);

  const providerName = account.type === "ledger" ? "Ledger" : "Trezor";

  return (
    <ScreenSection
      title="Hardware wallet"
    >
      <ListSurface>
        <ListItem>
          <ListItemContent>
            <ListItemTitle>{device?.label || providerName}</ListItemTitle>
            <ListItemDescription>
              {device?.model || `${providerName} model unavailable`}
            </ListItemDescription>
          </ListItemContent>
        </ListItem>
        <ListItem>
          <ListItemContent>
            <ListItemTitle>Derivation path</ListItemTitle>
            <VStack spacing={0} align="stretch">
              <Text color="fg.secondary" fontFamily="mono" fontSize="sm">
                {account.hdPath}
              </Text>
              <HStack spacing={1}>
                <ListItemDescription>Account index</ListItemDescription>
                <Text color="fg.secondary" fontFamily="mono" fontSize="sm">
                  {account.hdIndex}
                </Text>
              </HStack>
            </VStack>
          </ListItemContent>
        </ListItem>
      </ListSurface>
    </ScreenSection>
  );
}
