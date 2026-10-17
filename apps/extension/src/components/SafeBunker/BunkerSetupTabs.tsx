import { Button, HStack } from "@chakra-ui/react";

/** Matches the compact mode control used when adding a private key. */
export function BunkerSetupTabs({ mode, onChange, disabled }: { mode: "create" | "restore"; onChange: (mode: "create" | "restore") => void; disabled?: boolean }) {
  return <HStack spacing={1} mb={4} p={1} bg="surface.sunken" border="1px solid" borderColor="border.subtle" borderRadius="md" role="group" aria-label="Bunker setup mode">
    {([['create', 'Create new'], ['restore', 'Restore existing']] as const).map(([value, label]) => <Button key={value} flex={1} size="sm" variant="ghost" fontWeight="600" aria-pressed={mode === value}
      bg={mode === value ? "surface.raisedHover" : "transparent"} color={mode === value ? "fg.primary" : "fg.secondary"}
      _hover={{ bg: "surface.raisedHover", color: "fg.primary" }} isDisabled={disabled} onClick={() => onChange(value)}>{label}</Button>)}
  </HStack>;
}
