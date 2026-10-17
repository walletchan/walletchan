import { useState } from "react";
import { Button, HStack, IconButton, Text, Tooltip } from "@chakra-ui/react";
import { CheckIcon, CopyIcon, WarningIcon } from "@chakra-ui/icons";
import { useTheme } from "@/theme";

export function RevertWarning({ shortError, fullError, onRetry, isDisabled }: { shortError: string; fullError: string; onRetry: () => void; isDisabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const { tokens } = useTheme();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullError);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard writes can fail when the extension view is not focused.
    }
  };

  return (
    <HStack
      bg="status.error.bg"
      border={tokens.borders.medium}
      borderColor="status.error.border"
      borderRadius="lg"
      boxShadow="card"
      px={3}
      py={2}
      spacing={2}
    >
      <WarningIcon color="status.error.fg" boxSize={3.5} flexShrink={0} />
      <Text fontSize="xs" color="status.error.fg" fontWeight="600" flex="1" noOfLines={2}>
        TX may revert: {shortError}
      </Text>
      <Tooltip label="Copy full error" fontSize="xs" hasArrow>
        <IconButton
          aria-label="Copy full error"
          icon={copied ? <CheckIcon /> : <CopyIcon />}
          size="xs"
          minW="24px"
          w="24px"
          h="24px"
          variant="ghost"
          color={copied ? "accent.highlight" : "status.error.fg"}
          onClick={handleCopy}
          _hover={{ color: "status.error.fg", bg: "blackAlpha.200" }}
          flexShrink={0}
        />
      </Tooltip>
      <Button size="xs" variant="ghost" color="status.error.fg" flexShrink={0} isDisabled={isDisabled} onClick={onRetry}>Retry</Button>
    </HStack>
  );
}
