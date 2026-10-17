import { Box } from "@chakra-ui/react";
import { HardwareWalletLogo } from "./HardwareWalletLogo";
import type { HardwareWalletBrand } from "./types";

/** Provider identity used where an address blockie would be misleading. */
export function HardwareWalletAvatar({
  brand,
  size = 20,
}: {
  brand: HardwareWalletBrand;
  size?: number;
}) {
  return (
    <Box
      boxSize={`${size}px`}
      minW={`${size}px`}
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="md"
      bg="surface.sunken"
      color="fg.primary"
      display="grid"
      placeItems="center"
    >
      <HardwareWalletLogo brand={brand} variant="lettermark" w="62%" />
    </Box>
  );
}
