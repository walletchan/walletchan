import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { EditIcon } from "@chakra-ui/icons";
import { Fragment, useEffect, useState } from "react";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  ListItem,
  ListSurface,
  SkeletonRow,
} from "@/components/ui";
import { ActivityDateHeader } from "@/components/Activity/ActivityDateHeader";
import {
  groupActivityByDate,
  formatTimeAgo,
} from "@/components/Activity/activityModel";
import type { SignatureHistoryEntry } from "@/chrome/signatureHistory/types";
import { useSignatureHistory } from "./useSignatureHistory";
import { signatureOrigin, signatureTitle } from "./presentation";
import { SignatureDetails } from "./SignatureDetails";

export function SignatureHistoryList({
  address,
  chainId,
}: {
  address?: string;
  chainId?: number | null;
}) {
  const { entries, loading, error, refresh } = useSignatureHistory(
    address,
    chainId,
  );
  const [selected, setSelected] = useState<SignatureHistoryEntry | null>(null);
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    setSelected(null);
    setLimit(30);
  }, [address, chainId]);
  const groups = groupActivityByDate(entries.slice(0, limit), new Date());
  return (
    <VStack align="stretch" spacing={3}>
      {loading ? (
        <ListSurface aria-label="Loading signatures">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </ListSurface>
      ) : error || !entries.length ? (
        <EmptyState>
          <EmptyStateHeader>
            <EmptyStateTitle>
              {error ? "Signatures unavailable" : "No signed messages yet"}
            </EmptyStateTitle>
            {error && <EmptyStateDescription>{error}</EmptyStateDescription>}
          </EmptyStateHeader>
          {error && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          )}
        </EmptyState>
      ) : (
        <ListSurface aria-label="Signed message history">
          {groups.map((group) => (
            <Fragment key={group.label}>
              <ActivityDateHeader label={group.label} />
              {group.txs.map((entry) => (
                <ListItem
                  key={entry.id}
                  interactive
                  density="compact"
                  minH="64px"
                  gap={3}
                  onClick={() => setSelected(entry)}
                  aria-label={`View ${signatureTitle(entry)} for ${signatureOrigin(entry.origin)}`}
                >
                  <Box
                    bg="surface.accentTint"
                    color="accent.highlight"
                    p={2}
                    borderRadius="md"
                    flexShrink={0}
                  >
                    <EditIcon boxSize={4} />
                  </Box>
                  <Box flex={1} minW={0}>
                    <Text fontSize="sm" fontWeight="600" noOfLines={1}>
                      {signatureTitle(entry)}
                    </Text>
                    <Text fontSize="xs" color="fg.secondary" noOfLines={1}>
                      {signatureOrigin(entry.origin)}
                    </Text>
                  </Box>
                  <Text fontSize="2xs" color="fg.muted" flexShrink={0}>
                    {formatTimeAgo(entry.createdAt, Date.now())}
                  </Text>
                </ListItem>
              ))}
            </Fragment>
          ))}
        </ListSurface>
      )}
      {!loading && entries.length > limit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLimit((value) => value + 30)}
        >
          Load more signatures
        </Button>
      )}
      {selected && (
        <SignatureDetails entry={selected} onClose={() => setSelected(null)} />
      )}
    </VStack>
  );
}
