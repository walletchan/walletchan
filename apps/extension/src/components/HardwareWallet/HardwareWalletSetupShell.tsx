import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Full-tab shell shared by hardware-account setup providers. */
export function HardwareWalletSetupShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Box bg="bg.base" h="100%" display="flex" flexDirection="column">
      <Box
        maxW="600px"
        mx="auto"
        w="100%"
        h="100%"
        display="flex"
        flexDirection="column"
      >
        {children}
      </Box>
    </Box>
  );
}
