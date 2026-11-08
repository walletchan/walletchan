import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@chakra-ui/react";
import AddHardwareWalletFlow, {
  type HardwareWalletFlowLayoutParts,
} from "@/components/HardwareWallet/AddHardwareWalletFlow";
import type { HardwareWalletAccountSelection } from "@/components/HardwareWallet/types";
import {
  AppHeader,
  AppScreen,
  InlineDisclosure,
  ScreenBody,
  ScreenSection,
  StickyActionBar,
} from "@/components/ui";
import { createLatticeHardwareWalletProvider } from "./latticeFlowAdapter";

export interface AddLatticeFlowProps {
  onBack(): void;
  onComplete(): void;
  commitAccounts?(selection: HardwareWalletAccountSelection): Promise<void>;
  renderLayout?(parts: HardwareWalletFlowLayoutParts): ReactNode;
  showDevicePanelHeading?: boolean;
}

type PairingPrompt = {
  resolve(code: string): void;
  reject(error: Error): void;
};

export default function AddLatticeFlow({ onBack, onComplete, commitAccounts, renderLayout, showDevicePanelHeading }: AddLatticeFlowProps) {
  const [relayDeviceId, setRelayDeviceId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [connected, setConnected] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingPrompt, setPairingPrompt] = useState<PairingPrompt | null>(null);
  const connection = useRef({ relayDeviceId, endpoint });
  connection.current = { relayDeviceId, endpoint };

  // One provider per mounted flow; it reads the form through a ref.
  const provider = useMemo(
    () =>
      createLatticeHardwareWalletProvider({
        getConnection: () => connection.current,
        requestPairingCode: () =>
          new Promise<string>((resolve, reject) => {
            setPairingCode("");
            setPairingPrompt({ resolve, reject });
          }),
        onConnected: () => setConnected(true),
      }),
    [],
  );

  const submitPairing = () => {
    if (!pairingPrompt || !pairingCode.trim()) return;
    pairingPrompt.resolve(pairingCode.trim());
    setPairingPrompt(null);
  };
  const cancelPairing = () => {
    pairingPrompt?.reject(new Error("Pairing cancelled."));
    setPairingPrompt(null);
  };

  const connectionForm = (
    <ScreenSection
      title="Connection"
      description="Find the device ID on your Lattice under Settings, then Device Info."
    >
      <VStack spacing={4} align="stretch">
        <FormControl isRequired isDisabled={connected}>
          <FormLabel>Device ID</FormLabel>
          <Input
            value={relayDeviceId}
            placeholder="e.g. A1B2C3"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            onChange={(event) => setRelayDeviceId(event.target.value.replace(/[^A-Za-z0-9]/g, ""))}
          />
        </FormControl>
        <InlineDisclosure label="Advanced" description="Use your own Lattice Connect relay instead of GridPlus's.">
          <FormControl isDisabled={connected} mt={3}>
            <FormLabel>Connection endpoint</FormLabel>
            <Input
              value={endpoint}
              placeholder="https://signing.gridpl.us"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <FormHelperText>
              Leave empty for the GridPlus relay. A self-hosted relay usually runs at http://localhost:8080.
            </FormHelperText>
          </FormControl>
        </InlineDisclosure>
        {pairingPrompt && (
          <FormControl isRequired>
            <FormLabel>Pairing code</FormLabel>
            <Input
              autoFocus
              value={pairingCode}
              placeholder="Code shown on your Lattice"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitPairing();
              }}
            />
            <FormHelperText>Your Lattice shows this code for about a minute.</FormHelperText>
            <HStack mt={3} spacing={3}>
              <Button variant="brand" isDisabled={!pairingCode.trim()} onClick={submitPairing}>
                Pair
              </Button>
              <Button variant="secondary" onClick={cancelPairing}>
                Cancel
              </Button>
            </HStack>
          </FormControl>
        )}
      </VStack>
    </ScreenSection>
  );

  const layout = ({ content, primaryAction }: HardwareWalletFlowLayoutParts) => {
    const parts = {
      content: (
        <VStack spacing={6} align="stretch">
          {connectionForm}
          {content}
        </VStack>
      ),
      primaryAction,
    };
    if (renderLayout) return renderLayout(parts);
    return (
      <AppScreen>
        <AppHeader title="Connect Lattice" onBack={onBack} />
        <ScreenBody pt={5}>{parts.content}</ScreenBody>
        <StickyActionBar primaryAction={parts.primaryAction} />
      </AppScreen>
    );
  };

  return (
    <AddHardwareWalletFlow
      provider={provider}
      showDevicePanelHeading={showDevicePanelHeading}
      onBack={onBack}
      onComplete={onComplete}
      commitAccounts={commitAccounts}
      renderLayout={layout}
    />
  );
}
