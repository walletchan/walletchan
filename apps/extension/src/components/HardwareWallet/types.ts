export type HardwareWalletLogoVariant = "lettermark" | "wordmark";

export interface HardwareWalletBrand {
  name: string;
  logoAssets: Record<HardwareWalletLogoVariant, string>;
  logoAspectRatios: Record<HardwareWalletLogoVariant, number>;
}

export interface HardwareWalletDerivationOption<Scheme extends string> {
  value: Scheme;
  label: string;
  path: string;
}

export type HardwareWalletAddressSelection = {
  address: `0x${string}`;
  hdPath: string;
  hdIndex: number;
};

export type HardwareWalletAccountSelection = {
  deviceId: string;
  deviceLabel: string;
  deviceModel: string;
  addresses: HardwareWalletAddressSelection[];
};

export type HardwareWalletDevice = Omit<
  HardwareWalletAccountSelection,
  "addresses"
>;

export interface HardwareWalletFlowCopy {
  initialStatus: string;
  connectedStatus: string;
  addingStatus: string;
  connectError: string;
  scanError: string;
  addError: string;
  statusLabels: Readonly<Record<string, string>>;
  devicePanel: {
    connectedDescription: string;
    readyStatusDescription: string;
    disconnectedDescription: string;
    disconnectedStatusDescription: string;
  };
}

export interface HardwareWalletFlowOperations<Scheme extends string> {
  getExistingAccounts(): Promise<Array<{ type: string; address: string }>>;
  connect(opId: string): Promise<HardwareWalletDevice>;
  scan(input: {
    opId: string;
    deviceId: string;
    startIndex: number;
    count: number;
    scheme: Scheme;
  }): Promise<HardwareWalletAddressSelection[]>;
  commitAccounts(selection: HardwareWalletAccountSelection): Promise<void>;
  subscribeStatus(
    opId: string,
    onStatus: (status: string) => void,
  ): () => void;
  cancel?(opId: string): Promise<void>;
}

export interface HardwareWalletFlowProvider<Scheme extends string> {
  name: string;
  brand: HardwareWalletBrand;
  defaultScheme: Scheme;
  derivationOptions: ReadonlyArray<HardwareWalletDerivationOption<Scheme>>;
  copy: HardwareWalletFlowCopy;
  operations: HardwareWalletFlowOperations<Scheme>;
}
