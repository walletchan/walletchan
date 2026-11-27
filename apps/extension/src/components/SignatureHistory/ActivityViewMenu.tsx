import { IconButton, useDisclosure } from "@chakra-ui/react";
import { useRef } from "react";
import { ActionSheet, OverflowMenuIcon } from "@/components/ui";
import type { ActivityView } from "./useActivityView";

export function ActivityViewMenu({
  view,
  onChange,
}: {
  view: ActivityView;
  onChange: (view: ActivityView) => void;
}) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={triggerRef}
        aria-label="Activity options"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        icon={<OverflowMenuIcon boxSize="18px" />}
        size="sm"
        variant="ghost"
        color="fg.secondary"
        _hover={{ color: "fg.primary", bg: "surface.raisedHover" }}
        _active={{ color: "fg.primary", bg: "surface.sunken" }}
        onClick={onOpen}
      />
      <ActionSheet
        isOpen={isOpen}
        onClose={onClose}
        title="Activity options"
        density="compact"
        finalFocusRef={triggerRef}
        choices={([
          ["transactions", "Transactions"],
          ["signatures", "Signatures"],
        ] as const).map(([id, label]) => ({
          id,
          label,
          group: "view",
          isSelected: view === id,
          selectionVariant: "indicator-only",
        }))}
        onSelect={(value) => {
          if (value === "transactions" || value === "signatures") onChange(value);
        }}
      />
    </>
  );
}
