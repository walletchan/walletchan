import { Button } from "@chakra-ui/react";
import type { AccountType } from "@/components/AddAccountTypeGrid";
import { StickyActionBar } from "@/components/ui";
import { BackupConfirmationCheckbox } from "@/components/shared/BackupConfirmationCheckbox";

interface AddAccountActionBarProps {
  accountType: AccountType;
  needsBiometricUpgrade: boolean | null;
  isSubmitting: boolean;
  isAuthenticating: boolean;
  canAddPrivateKey: boolean;
  privateKeyBackup: { isGenerated: boolean; isConfirmed: boolean };
  onPrivateKeyBackupChange: (isConfirmed: boolean) => void;
  canAddBankr: boolean;
  canAddImpersonator: boolean;
  onAddAccount: () => void;
}

export function AddAccountActionBar({
  accountType,
  needsBiometricUpgrade,
  isSubmitting,
  isAuthenticating,
  canAddPrivateKey,
  privateKeyBackup,
  onPrivateKeyBackupChange,
  canAddBankr,
  canAddImpersonator,
  onAddAccount,
}: AddAccountActionBarProps) {
  const isLocalAccount =
    accountType === "privateKey" || accountType === "seedPhrase";
  if (
    accountType === "seedPhrase" ||
    needsBiometricUpgrade === null ||
    (needsBiometricUpgrade && isLocalAccount)
  ) {
    return null;
  }

  return (
    <StickyActionBar
      summaryGap={2}
      summary={
        accountType === "privateKey" && privateKeyBackup.isGenerated ? (
          <BackupConfirmationCheckbox
            isChecked={privateKeyBackup.isConfirmed}
            label="I saved this private key"
            onChange={onPrivateKeyBackupChange}
          />
        ) : undefined
      }
      primaryAction={
        <Button
          variant="brand"
          onClick={onAddAccount}
          isLoading={isSubmitting || isAuthenticating}
          loadingText={isAuthenticating ? "Authenticating…" : "Adding…"}
          isDisabled={
            (accountType === "privateKey" && !canAddPrivateKey) ||
            (accountType === "bankr" && !canAddBankr) ||
            (accountType === "impersonator" && !canAddImpersonator)
          }
        >
          Add account
        </Button>
      }
    />
  );
}
