import { Box, Spinner } from "@chakra-ui/react";
import { ViewOnlySigningNotice } from "@/components/shared/ViewOnlySigningNotice";
import { HardwareWalletLogo } from "./HardwareWalletLogo";
import type { HardwareWalletBrand } from "./types";

/** Keeps a provider's hardware action visible without replacing request review. */
export function HardwareWalletSigningStatus({
  active,
  brand,
  message,
}: {
  active: boolean;
  brand: HardwareWalletBrand;
  message: string;
}) {
  if (!active) return null;
  return (
    <ViewOnlySigningNotice
      message={message}
      icon={
        <Box
          boxSize="28px"
          bg="black"
          color="white"
          borderRadius="sm"
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <HardwareWalletLogo
            brand={brand}
            variant="lettermark"
            w="16px"
            color="white"
          />
        </Box>
      }
      trailing={
        <Spinner size="sm" color="accentFg.highlight" flexShrink={0} />
      }
    />
  );
}
