import { Box, type BoxProps } from "@chakra-ui/react";
import type {
  HardwareWalletBrand,
  HardwareWalletLogoVariant,
} from "./types";

/** Locally packaged provider mark, colored through the active WalletChan theme. */
export function HardwareWalletLogo({
  brand,
  variant = "wordmark",
  ...props
}: BoxProps & {
  brand: HardwareWalletBrand;
  variant?: HardwareWalletLogoVariant;
}) {
  const asset = brand.logoAssets[variant];
  return (
    <Box
      role="img"
      aria-label={brand.name}
      flexShrink={0}
      color="fg.primary"
      bg="currentColor"
      aspectRatio={brand.logoAspectRatios[variant]}
      sx={{
        maskImage: `url(${asset})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(${asset})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
      {...props}
    />
  );
}
