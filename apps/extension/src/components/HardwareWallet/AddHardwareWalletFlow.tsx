import { etherscanAddressUrl } from "@/constants/externalUrls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import { CopyButton } from "@/components/CopyButton";
import {
  AppHeader,
  AppScreen,
  ListItem,
  ListItemActions,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemTitle,
  ListSurface,
  ScreenBody,
  ScreenSection,
  StickyActionBar,
} from "@/components/ui";
import { HardwareWalletDerivationPicker } from "./HardwareWalletDerivationPicker";
import { HardwareWalletDevicePanel } from "./HardwareWalletDevicePanel";
import type {
  HardwareWalletAccountSelection,
  HardwareWalletAddressSelection,
  HardwareWalletDevice,
  HardwareWalletFlowProvider,
} from "./types";

export interface HardwareWalletFlowLayoutParts {
  content: ReactNode;
  primaryAction: ReactNode;
}

export interface AddHardwareWalletFlowProps<Scheme extends string> {
  provider: HardwareWalletFlowProvider<Scheme>;
  onBack(): void;
  onComplete(): void;
  commitAccounts?(selection: HardwareWalletAccountSelection): Promise<void>;
  renderLayout?(parts: HardwareWalletFlowLayoutParts): ReactNode;
  showDevicePanelHeading?: boolean;
}

export default function AddHardwareWalletFlow<Scheme extends string>({
  provider,
  onBack,
  onComplete,
  commitAccounts,
  renderLayout,
  showDevicePanelHeading = true,
}: AddHardwareWalletFlowProps<Scheme>) {
  const [device, setDevice] = useState<HardwareWalletDevice | null>(null);
  const [addresses, setAddresses] = useState<
    HardwareWalletAddressSelection[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheme, setScheme] = useState<Scheme>(provider.defaultScheme);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(provider.copy.initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [existingAddresses, setExistingAddresses] = useState<Set<string>>(
    new Set(),
  );
  const activeOperationId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void provider.operations.getExistingAccounts().then((accounts) => {
      if (!active) return;
      setExistingAddresses(
        new Set(
          accounts
            .filter((account) => account.type !== "impersonator")
            .map((account) => account.address.toLowerCase()),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [provider]);

  useEffect(
    () => () => {
      const opId = activeOperationId.current;
      activeOperationId.current = null;
      if (opId) {
        void provider.operations.cancel?.(opId).catch(() => undefined);
      }
    },
    [provider],
  );

  const runHardwareOperation = async <T,>(
    operation: (opId: string) => Promise<T>,
  ): Promise<T> => {
    const opId = crypto.randomUUID();
    activeOperationId.current = opId;
    const unsubscribe = provider.operations.subscribeStatus(
      opId,
      (nextStatus) => {
        const label = provider.copy.statusLabels[nextStatus];
        if (label) setStatus(label);
      },
    );
    try {
      return await operation(opId);
    } finally {
      if (activeOperationId.current === opId) {
        activeOperationId.current = null;
      }
      unsubscribe();
    }
  };

  const scan = async (
    target: HardwareWalletDevice,
    targetScheme: Scheme,
    startIndex: number,
    replace: boolean,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const rows = await runHardwareOperation((opId) =>
        provider.operations.scan({
          opId,
          deviceId: target.deviceId,
          startIndex,
          count: 5,
          scheme: targetScheme,
        }),
      );
      setAddresses((current) => (replace ? rows : [...current, ...rows]));
      setStatus(provider.copy.connectedStatus);
      if (replace) {
        const firstNew = rows.find(
          (row) => !existingAddresses.has(row.address.toLowerCase()),
        );
        setSelected(
          new Set(firstNew ? [firstNew.address.toLowerCase()] : []),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : provider.copy.scanError,
      );
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextDevice = await runHardwareOperation((opId) =>
        provider.operations.connect(opId),
      );
      setDevice(nextDevice);
      await scan(nextDevice, scheme, 0, true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : provider.copy.connectError,
      );
    } finally {
      setBusy(false);
    }
  };

  const changeScheme = (value: Scheme) => {
    setScheme(value);
    setAddresses([]);
    setSelected(new Set());
    if (device) void scan(device, value, 0, true);
  };

  const addSelected = async () => {
    if (!device || !selected.size) return;
    setBusy(true);
    setError(null);
    setStatus(provider.copy.addingStatus);
    try {
      const chosen = addresses.filter((row) =>
        selected.has(row.address.toLowerCase()),
      );
      const selection: HardwareWalletAccountSelection = {
        ...device,
        addresses: chosen,
      };
      if (commitAccounts) {
        await commitAccounts(selection);
      } else {
        await provider.operations.commitAccounts(selection);
      }
      onComplete();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : provider.copy.addError,
      );
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <VStack spacing={6} align="stretch">
      <HardwareWalletDevicePanel
        brand={provider.brand}
        showHeading={showDevicePanelHeading}
        device={device}
        busy={busy}
        status={status}
        {...provider.copy.devicePanel}
      />

      {device && (
        <HardwareWalletDerivationPicker
          value={scheme}
          onChange={changeScheme}
          options={provider.derivationOptions}
        />
      )}

      {device && (
        <ScreenSection
          title="Choose accounts"
          description="Select one or more addresses to add."
        >
          <ListSurface>
            {addresses.map((row) => {
              const key = row.address.toLowerCase();
              const alreadyAdded = existingAddresses.has(key);
              const checked = selected.has(key);
              return (
                <ListItem
                  key={`${row.hdPath}:${key}`}
                  interactive
                  isDisabled={alreadyAdded}
                  isSelected={checked}
                  onClick={() => {
                    if (alreadyAdded) return;
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                >
                  <ListItemMedia>
                    <Checkbox
                      isChecked={checked}
                      isDisabled={alreadyAdded}
                      pointerEvents="none"
                      aria-label={`Select ${row.address}`}
                    />
                  </ListItemMedia>
                  <ListItemContent>
                    <ListItemTitle fontFamily="mono">
                      {row.address.slice(0, 8)}…{row.address.slice(-6)}
                    </ListItemTitle>
                    <ListItemDescription fontFamily="mono">
                      {row.hdPath}
                    </ListItemDescription>
                  </ListItemContent>
                  <ListItemActions>
                    {alreadyAdded && <Badge>Added</Badge>}
                    <CopyButton value={row.address} />
                    <IconButton
                      as="a"
                      href={etherscanAddressUrl(row.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View address on explorer"
                      icon={<ExternalLinkIcon />}
                      size="xs"
                      variant="ghost"
                      onClick={(event) => event.stopPropagation()}
                    />
                  </ListItemActions>
                </ListItem>
              );
            })}
          </ListSurface>
          <Button
            mt={3}
            w="full"
            variant="secondary"
            isDisabled={busy}
            onClick={() => void scan(device, scheme, addresses.length, false)}
          >
            Load 5 more
          </Button>
        </ScreenSection>
      )}

      {error && (
        <Box
          role="alert"
          p={3}
          bg="status.error.bg"
          border="1px solid"
          borderColor="status.error.border"
          borderRadius="md"
        >
          <Text color="status.error.fg" fontSize="sm" fontWeight="600">
            {error}
          </Text>
        </Box>
      )}
    </VStack>
  );

  const primaryAction = device ? (
    <Button
      variant="brand"
      isLoading={busy}
      loadingText={commitAccounts ? "Continuing…" : "Adding…"}
      isDisabled={!selected.size}
      onClick={() => void addSelected()}
    >
      {commitAccounts
        ? "Continue"
        : `Add ${selected.size || ""} account${selected.size === 1 ? "" : "s"}`}
    </Button>
  ) : (
    <Button
      variant="brand"
      isLoading={busy}
      loadingText="Connecting…"
      onClick={() => void connect()}
    >
      Connect {provider.name}
    </Button>
  );

  if (renderLayout) return <>{renderLayout({ content, primaryAction })}</>;

  return (
    <AppScreen>
      <AppHeader title={`Connect ${provider.name}`} onBack={onBack} />
      <ScreenBody pt={5}>{content}</ScreenBody>
      <StickyActionBar primaryAction={primaryAction} />
    </AppScreen>
  );
}
