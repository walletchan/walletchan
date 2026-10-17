import { Box, Radio, RadioGroup, Text, VStack } from "@chakra-ui/react";
import { ScreenSection } from "@/components/ui";
import type { HardwareWalletDerivationOption } from "./types";

export function HardwareWalletDerivationPicker<Scheme extends string>({
  value,
  onChange,
  options,
}: {
  value: Scheme;
  onChange(value: Scheme): void;
  options: ReadonlyArray<HardwareWalletDerivationOption<Scheme>>;
}) {
  return (
    <ScreenSection
      title="Derivation path"
      description="Choose the layout used when the accounts were created."
    >
      <RadioGroup
        value={value}
        onChange={(nextValue) => onChange(nextValue as Scheme)}
      >
        <VStack align="stretch" spacing={2}>
          {options.map((option) => (
            <Radio key={option.value} value={option.value} py={1.5}>
              <Box ml={1}>
                <Text color="fg.primary" fontWeight="600">
                  {option.label}
                </Text>
                <Text
                  mt={0.5}
                  color="fg.secondary"
                  fontFamily="mono"
                  fontSize="sm"
                >
                  {option.path}
                </Text>
              </Box>
            </Radio>
          ))}
        </VStack>
      </RadioGroup>
    </ScreenSection>
  );
}
