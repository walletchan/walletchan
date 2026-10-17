import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Flex, HStack, Text, Tooltip } from "@chakra-ui/react";
import { CheckIcon } from "@chakra-ui/icons";
import type { Account } from "@/chrome/types";
import { AccountAvatar } from "@/components/AccountIdentity";
import {
  ListItem,
  ListItemActions,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemTitle,
} from "@/components/ui";

interface AccountPickerRowProps {
  account: Account;
  displayName: string;
  ensAvatar: string | null;
  secondaryIdentity: string;
  walletTypeLabel: string;
  isSelected: boolean;
  isDisabled?: boolean;
  statusLabel?: string;
  actions?: ReactNode;
  leadingAction?: ReactNode;
  isDragging?: boolean;
  style?: CSSProperties;
  onSelect: () => void;
}

/** Shared account-choice row used by the wallet and connection pickers. */
export const AccountPickerRow = forwardRef<HTMLElement, AccountPickerRowProps>(
  function AccountPickerRow(
    {
      account,
      displayName,
      ensAvatar,
      secondaryIdentity,
      walletTypeLabel,
      isSelected,
      isDisabled = false,
      statusLabel,
      actions,
      leadingAction,
      isDragging = false,
      style,
      onSelect,
    },
    ref,
  ) {
    const hasSecondaryIdentity = secondaryIdentity.toLowerCase() !== displayName.toLowerCase();
    const titleRef = useRef<HTMLElement>(null);
    const [isNameTruncated, setIsNameTruncated] = useState(false);
    useLayoutEffect(() => {
      const title = titleRef.current;
      if (!title) return;
      const measure = () => setIsNameTruncated(
        title.scrollWidth > title.clientWidth || title.scrollHeight > title.clientHeight,
      );
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(title);
      document.fonts.addEventListener("loadingdone", measure);
      return () => {
        observer.disconnect();
        document.fonts.removeEventListener("loadingdone", measure);
      };
    }, [displayName]);

    const rowActions = actions && (
      <ListItemActions
        position="relative"
        pointerEvents="auto"
        sx={{ "&& > *:hover": { color: "accent.highlight", bg: "surface.raisedHover" } }}
      >
        {actions}
      </ListItemActions>
    );

    return (
      <ListItem
        ref={ref}
        px={0}
        py={0}
        gap={0}
        isSelected={isSelected}
        isDisabled={isDisabled}
        data-dragging={isDragging ? "" : undefined}
        style={style}
        zIndex={isDragging ? 2 : 0}
        bg={isDragging || isSelected ? "surface.raisedHover" : undefined}
        boxShadow={isDragging ? "0 8px 20px rgba(0, 0, 0, 0.28)" : undefined}
        transitionProperty="background-color, box-shadow"
        transitionDuration="fast"
        _hover={
          isSelected || isDisabled ? undefined : { bg: "surface.raisedHover" }
        }
      >
        {leadingAction}
        <Flex minW={0} flex={1} minH="64px" px={3} py={2.5} gap={3} align="center" position="relative">
          <Box
            as="button"
            type="button"
            position="absolute"
            inset={0}
            w="full"
            h="full"
            aria-label={`${displayName} ${hasSecondaryIdentity ? secondaryIdentity : ""} ${statusLabel || walletTypeLabel}`.trim()}
            disabled={isDisabled}
            _focus={{ outline: "none" }}
            _focusVisible={{ boxShadow: "inset 0 0 0 2px var(--chakra-colors-border-focus)" }}
            _disabled={{ cursor: "wait", opacity: 0.6 }}
            onClick={onSelect}
          />
          <ListItemMedia pointerEvents="none">
            <AccountAvatar account={account} ensAvatar={ensAvatar} size={36} />
          </ListItemMedia>
          <ListItemContent pointerEvents="none">
            <Tooltip label={displayName} isDisabled={!isNameTruncated} hasArrow placement="top" openDelay={200}>
              <ListItemTitle
                ref={titleRef}
                noOfLines={1}
                position="relative"
                pointerEvents="auto"
                onClick={isDisabled ? undefined : onSelect}
              >
                {displayName}
              </ListItemTitle>
            </Tooltip>
            <HStack spacing={2} minW={0} justify="space-between">
              <Box minW={0} flex={1}>
                {hasSecondaryIdentity && (
                  <ListItemDescription display="block" fontFamily="mono" noOfLines={1}>
                    {secondaryIdentity}
                  </ListItemDescription>
                )}
                <HStack spacing={1.5} minW={0}>
                  <Text as="span" color="fg.muted" fontSize="xs" lineHeight="1.4">
                    {statusLabel || walletTypeLabel}
                  </Text>
                  {isSelected && <CheckIcon boxSize={3} color="accent.secondary" flexShrink={0} />}
                </HStack>
              </Box>
              {hasSecondaryIdentity && rowActions}
            </HStack>
          </ListItemContent>
          {!hasSecondaryIdentity && rowActions}
        </Flex>
      </ListItem>
    );
  },
);
