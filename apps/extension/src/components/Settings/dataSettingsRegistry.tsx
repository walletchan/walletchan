import { DownloadIcon } from "@chakra-ui/icons";
import { SettingsRow } from "./SettingsRow";
import { TrashIcon, ResetIcon, ChatBubbleIcon } from "./icons";
import type { LeafEntry, LeafId, RowContext } from "./settingsRegistry";

export const DATA_SETTINGS_ENTRIES: readonly LeafEntry[] = [
  {
    id: "activityHistory",
    title: "Activity History",
    subtitle: "Export transactions and signed messages as JSON",
    keywords: [
      "export",
      "download",
      "json",
      "signatures",
      "messages",
      "activity",
      "logs",
      "history",
    ],
    group: "data",
  },
  {
    id: "clearTxHistory",
    title: "Clear Transaction History",
    subtitle: "Remove all transaction records",
    keywords: [
      "clear",
      "transaction",
      "history",
      "tx",
      "data",
      "remove",
      "delete",
    ],
    group: "data",
  },
  {
    id: "clearSignatureHistory",
    title: "Clear Signature History",
    subtitle: "Remove saved signature records",
    keywords: ["clear", "delete", "signed", "messages", "signatures", "history"],
    group: "data",
  },
  {
    id: "resetNonce",
    title: "Reset Nonce Cache",
    subtitle: "Fix stuck transactions from nonce conflicts",
    keywords: ["nonce", "reset", "stuck", "cache", "data"],
    group: "data",
  },
  {
    id: "clearChatHistory",
    title: "Clear Chat History",
    subtitle: "Remove all Bankr chat conversations",
    keywords: [
      "clear",
      "chat",
      "history",
      "conversation",
      "data",
      "remove",
      "delete",
    ],
    group: "data",
  },
];

export function renderDataSettingsRow(id: LeafId, ctx: RowContext) {
  switch (id) {
    case "activityHistory":
      return (
        <SettingsRow
          key={id}
          title="Activity History"
          subtitle="Export transactions and signed messages"
          icon={<DownloadIcon boxSize={5} />}
          iconBg="surface.accentTint"
          iconColor="accent.secondary"
          iconHoverColor="accent.highlight"
          showChevron
          onClick={() => ctx.onNavigate(id)}
        />
      );
    case "clearSignatureHistory":
    case "clearTxHistory":
      return (
        <SettingsRow
          key={id}
          title={id === "clearTxHistory" ? "Clear Transaction History" : "Clear Signature History"}
          icon={<TrashIcon boxSize={5} />}
          iconBg="accent.primary"
          iconColor="accentFg.primary"
          iconHoverColor="chart.negative"
          cornerAccent="primary"
          showChevron
          onClick={() => ctx.onNavigate(id)}
        />
      );

    case "resetNonce":
      return (
        <SettingsRow
          key={id}
          title="Reset Nonce Cache"
          subtitle="Fix stuck transactions from nonce conflicts"
          icon={<ResetIcon boxSize={5} />}
          iconBg="accent.secondary"
          iconColor="accentFg.secondary"
          cornerAccent="secondary"
          onClick={() => ctx.onAction(id)}
        />
      );

    case "clearChatHistory":
      return (
        <SettingsRow
          key={id}
          title="Clear Chat History"
          subtitle="Remove all Bankr chat conversations"
          icon={<ChatBubbleIcon boxSize={5} />}
          iconBg="accent.primary"
          iconColor="accentFg.primary"
          iconHoverColor="chart.negative"
          cornerAccent="primary"
          borderRadiusFull
          onClick={() => ctx.onAction(id)}
        />
      );
    default:
      return null;
  }
}
