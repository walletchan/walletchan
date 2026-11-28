import type { PendingBunkerRequest } from "@/chrome/safeBunker/pendingRequests";
import { memo } from "react";
import { Button, Text } from "@chakra-ui/react";
import type { PendingTxRequest } from "@/chrome/requests/pendingTxStorage";
import type { PendingSignatureRequest } from "@/chrome/requests/pendingSignatureStorage";
import type { PendingErc7715PermissionRequest } from "@/chrome/pendingErc7715PermissionStorage";
import type { PendingBatchTxRequest } from "@/chrome/erc5792Types";
import type { CrossDappBatch } from "@/chrome/crossDappBatch/storage";
import { getCombinedRequests } from "@/app/requestModel";
import {
  AppHeader,
  AppScreen,
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateTitle,
  ListSurface, ListItem, ListItemContent, ListItemTitle, ListItemDescription,
  ScreenBody,
  StickyActionBar,
} from "@/components/ui";
import PendingRequestRow from "@/components/PendingRequestRow";

interface PendingTxListProps {
  txRequests: PendingTxRequest[];
  signatureRequests: PendingSignatureRequest[];
  permissionRequests?: PendingErc7715PermissionRequest[];
  batchRequests?: PendingBatchTxRequest[];
  crossDappBatch?: CrossDappBatch | null;
  bunkerRequests?: PendingBunkerRequest[];
  onSelectBunker?: (id: string) => void;
  onBack: () => void;
  onSelectTx: (txRequest: PendingTxRequest) => void;
  onSelectSignature: (sigRequest: PendingSignatureRequest) => void;
  onSelectPermission?: (request: PendingErc7715PermissionRequest) => void;
  onSelectBatch?: (batchRequest: PendingBatchTxRequest) => void;
  onSelectCrossDappBatch?: () => void;
  onRejectAll: () => void;
}

function PendingTxList({
  txRequests,
  bunkerRequests = [], onSelectBunker,
  signatureRequests,
  permissionRequests = [],
  batchRequests = [],
  crossDappBatch,
  onBack,
  onSelectTx,
  onSelectSignature,
  onSelectPermission,
  onSelectBatch,
  onSelectCrossDappBatch,
  onRejectAll,
}: PendingTxListProps) {
  const combinedRequests = getCombinedRequests(
    txRequests,
    signatureRequests,
    batchRequests,
    crossDappBatch,
    permissionRequests,
  );
  const totalCount = combinedRequests.length + bunkerRequests.length;

  return (
    <AppScreen>
      <AppHeader
        title="Pending requests"
        onBack={onBack}
        trailing={
          totalCount > 0 ? (
            <Text
              color="fg.secondary"
              fontSize="sm"
              fontWeight={600}
              sx={{ fontVariantNumeric: "tabular-nums" }}
              whiteSpace="nowrap"
            >
              {totalCount} {totalCount === 1 ? "request" : "requests"}
            </Text>
          ) : undefined
        }
      />

      <ScreenBody pt={4}>
        {totalCount > 0 ? (
          <>
            <Text color="fg.secondary" fontSize="sm" lineHeight="1.45" mb={4}>
              Review each request before approving. Requests stay here until
              you approve or reject them.
            </Text>

            <ListSurface aria-label="Pending requests">
              {combinedRequests.map((item, index) => (
                <PendingRequestRow
                  key={
                    item.type === "crossDappBatch"
                      ? "cross-dapp-batch"
                      : item.request.id
                  }
                  item={item}
                  position={index + 1}
                  totalCount={totalCount}
                  onSelectTx={onSelectTx}
                  onSelectSignature={onSelectSignature}
                  onSelectPermission={onSelectPermission}
                  onSelectBatch={onSelectBatch}
                  onSelectCrossDappBatch={onSelectCrossDappBatch}
                />
              ))}
              {bunkerRequests.map((request) => <ListItem key={`bunker:${request.id}`} as="button" interactive type="button" w="full" textAlign="start" onClick={() => onSelectBunker?.(request.id)}>
                <ListItemContent><ListItemTitle>Transaction request</ListItemTitle><ListItemDescription>Safe Bunker · Sepolia</ListItemDescription></ListItemContent>
              </ListItem>)}
            </ListSurface>
          </>
        ) : (
          <EmptyState minH="320px">
            <EmptyStateHeader>
              <EmptyStateTitle>You&apos;re all caught up</EmptyStateTitle>
              <EmptyStateDescription>
                New requests from connected apps will appear here.
              </EmptyStateDescription>
            </EmptyStateHeader>
          </EmptyState>
        )}
      </ScreenBody>

      {totalCount > 0 && bunkerRequests.length === 0 && (
        <StickyActionBar
          primaryAction={
            <Button variant="danger" minH="44px" onClick={onRejectAll}>
              Reject all ({totalCount})
            </Button>
          }
        />
      )}
    </AppScreen>
  );
}

export default memo(PendingTxList);
