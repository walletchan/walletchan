import { RepeatIcon } from "@chakra-ui/icons";
import { Button, HStack, Text } from "@chakra-ui/react";

interface RequestRetryNoticeProps {
  error: string;
  kind?: "error" | "warning";
  onRetry?: () => void;
  isLoading?: boolean;
  isDisabled?: boolean;
}

/** A read-only retry beside a wrapped request/preparation error. */
export function RequestRetryNotice({
  error,
  onRetry,
  isLoading = false,
  isDisabled = false,
  kind = "error",
}: RequestRetryNoticeProps) {
  return (
    <HStack minW={0} spacing={3} align="center">
      <Text
        role="alert"
        color={`status.${kind}.emphasis`}
        fontSize="xs"
        flex={1}
        minW={0}
        overflowWrap="anywhere"
      >
        {error}
      </Text>
      {onRetry && (
        <Button
          size="sm"
          variant="secondary"
          flexShrink={0}
          leftIcon={<RepeatIcon boxSize={3.5} />}
          onClick={onRetry}
          isLoading={isLoading}
          isDisabled={isDisabled}
        >
          Retry
        </Button>
      )}
    </HStack>
  );
}
