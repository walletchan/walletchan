import { Box, Portal, type BoxProps } from "@chakra-ui/react";
import { useLayoutEffect, type ReactNode } from "react";

interface FullScreenPickerLayerProps extends BoxProps {
  children: ReactNode;
}

/**
 * Portals a nested picker above the current app screen and makes the covered
 * application tree inert while the picker is active.
 */
export function FullScreenPickerLayer({
  children,
  ...rest
}: FullScreenPickerLayerProps) {
  // Restore the covered tree before picker triggers restore keyboard focus.
  useLayoutEffect(() => {
    const appRoot =
      document.getElementById("root") ??
      document.getElementById("preview-root");
    if (!appRoot) return;

    // Inert covers focus, interaction and the accessibility tree. aria-hidden
    // would hide the trigger before the picker transfers focus on the next frame.
    const wasInert = appRoot.hasAttribute("inert");
    appRoot.setAttribute("inert", "");

    return () => {
      if (!wasInert) appRoot.removeAttribute("inert");
    };
  }, []);

  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex="modal"
        bg="surface.base"
        {...rest}
      >
        {children}
      </Box>
    </Portal>
  );
}
