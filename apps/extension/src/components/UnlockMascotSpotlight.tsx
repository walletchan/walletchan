import { Box } from "@chakra-ui/react";
import { LockIcon } from "@chakra-ui/icons";
import type { ReactNode } from "react";
import UnlockMascot from "./UnlockMascot";
import type { UnlockMascotState } from "./unlockMascotState";

export default function UnlockMascotSpotlight({ state, badge = <LockIcon boxSize="16px" /> }: { state: UnlockMascotState; badge?: ReactNode }) {
  return (
    <Box
      position="relative"
      w="clamp(120px, 36vw, 148px)"
      h="clamp(120px, 36vw, 148px)"
      mx="auto"
      aria-hidden="true"
    >
      <Box
        position="absolute"
        inset="12%"
        bg="status.warning.tint"
        border="1px solid"
        borderColor="accent.highlight"
        borderRadius="12px"
        opacity={0.8}
        transform="rotate(-7deg)"
      />
      <Box position="relative" w="full" h="full">
        <UnlockMascot state={state} />
      </Box>
      <Box
        position="absolute"
        right="0"
        bottom="2px"
        display="grid"
        placeItems="center"
        boxSize="34px"
        bg="accent.highlight"
        color="accentFg.highlight"
        border="3px solid"
        borderColor="surface.base"
        borderRadius="8px"
        transform="rotate(4deg)"
      >
        {badge}
      </Box>
    </Box>
  );
}
