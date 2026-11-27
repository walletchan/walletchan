import type { ActivityView } from "./useActivityView";
import { Box } from "@chakra-ui/react";
import type { ComponentProps, ReactNode } from "react";
import ActivityList from "@/components/Activity/ActivityList";
import { SignatureHistoryList } from "./SignatureHistoryList";

/** Public Activity keeps its transaction owner mounted when browsing signatures. */
export default function ActivityHistory({
  supplement,
  view,
  ...props
}: ComponentProps<typeof ActivityList> & { supplement?: ReactNode; view: ActivityView }) {
  return (
    <Box>
      <Box
        display={view === "transactions" ? "block" : "none"}
        aria-hidden={view !== "transactions"}
      >
        {supplement}
        <ActivityList
          {...props}
          isActive={props.isActive !== false && view === "transactions"}
        />
      </Box>
      {view === "signatures" && (
        <SignatureHistoryList
          key={props.address}
          address={props.address}
          chainId={props.filterChainId}
        />
      )}
    </Box>
  );
}
