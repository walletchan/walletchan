import { Box, HStack, Text, Tooltip, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import TokenLogo from "@/components/TokenLogo";
import { CHAIN_REGISTRY } from "@/constants/chainRegistry";
import { useNetworks } from "@/contexts/NetworksContext";
import { getNativeAssetMeta, getResolvedChainById } from "@/lib/chains";
import type { TokenMetadataHint } from "@/lib/clearSigning/applyFormat";
import {
  getCachedTokenMetadataSync,
  resolveTokenMetadataClient,
} from "@/lib/tokenMetadataClient";

import {
  compareRawAmounts,
  formatUnit,
  formatUnitFull,
  formatUsdValue,
  isUnlimitedAmount,
  toTokenInfo,
  type TokenInfo,
} from "../formatters/valueFormatters";
import { TokenContractPopover } from "./TokenContractPopover";

/**
 * Headline amount text. When the raw value is a max-uint sentinel
 * (uint256 or Permit2's uint160), shows "unlimited" but lets the user
 * hover to see the precise amount the contract is actually approved for.
 */
function AmountText({
  amountRaw,
  decimals,
  symbol,
  thresholdRaw,
  thresholdMessage,
  allowUnlimited = true,
}: {
  amountRaw: string;
  decimals: number;
  symbol: string;
  thresholdRaw?: string;
  thresholdMessage?: string;
  allowUnlimited?: boolean;
}) {
  const unlimited = allowUnlimited && isUnlimitedAmount(amountRaw);
  const thresholdHit =
    thresholdRaw !== undefined &&
    thresholdMessage &&
    compareRawAmounts(amountRaw, thresholdRaw) >= 0;
  const displayText = thresholdHit
    ? thresholdMessage
    : formatUnit(amountRaw, decimals, allowUnlimited);
  const text = (
    <Text
      fontSize="lg"
      color="fg.primary"
      fontWeight="700"
      lineHeight="1.2"
      minW={0}
      maxW="full"
      overflowWrap="anywhere"
      sx={{ fontVariantNumeric: "tabular-nums" }}
    >
      {displayText}
    </Text>
  );
  const fullText = formatUnitFull(amountRaw, decimals);
  const compactText = displayText.replace(/,/g, "");
  if (!unlimited && !thresholdHit && compactText === fullText.replace(/,/g, "")) return text;
  return (
    <Tooltip
      label={`${fullText} ${symbol}`}
      placement="top"
      hasArrow
      openDelay={150}
    >
      {/* Box wrapper so the tooltip can fire on touch / focus without
          requiring the Text itself to forward refs. */}
      <Box as="span" tabIndex={0} minW={0} maxW="full" cursor="help" borderBottom="1px dotted" borderColor="fg.muted">
        {text}
      </Box>
    </Tooltip>
  );
}

export function TokenAmountInline({
  amountRaw,
  tokenAddress,
  native,
  chainId,
  thresholdRaw,
  thresholdMessage,
  metadataHint,
  allowUnlimited,
}: {
  amountRaw: string;
  tokenAddress?: string;
  native?: boolean;
  chainId: number;
  thresholdRaw?: string;
  thresholdMessage?: string;
  metadataHint?: TokenMetadataHint;
  allowUnlimited?: boolean;
}) {
  const initialInfo =
    !native && metadataHint
      ? toTokenInfo(metadataHint)
      : !native && tokenAddress
        ? toTokenInfo(getCachedTokenMetadataSync(chainId, tokenAddress))
        : null;
  const assetKey = `${chainId}:${native ? "native" : tokenAddress?.toLowerCase()}`;
  const [resolvedInfo, setResolvedInfo] = useState<{ key: string; info: TokenInfo | null }>(() => ({ key: assetKey, info: initialInfo }));
  const info = metadataHint ? toTokenInfo(metadataHint) : resolvedInfo.key === assetKey ? resolvedInfo.info : initialInfo;
  const [price, setPrice] = useState({ key: "", usd: 0 });
  const priceUsd = price.key === assetKey ? price.usd : 0;
  const { networksInfo } = useNetworks();
  const nativeInfo = useMemo(
    () => (native ? getNativeAssetMeta(chainId, networksInfo) : null),
    [chainId, native, networksInfo],
  );
  const explorer = useMemo(
    () => getResolvedChainById(chainId, networksInfo)?.explorer,
    [chainId, networksInfo],
  );

  useEffect(() => {
    if (native || !tokenAddress) {
      setResolvedInfo({ key: assetKey, info: metadataHint ? toTokenInfo(metadataHint) : null });
      return;
    }
    let cancelled = false;
    const applyMetadata = (
      metadata:
        | { symbol?: string; decimals?: number; logoUrl?: string }
        | null
        | undefined,
    ) => {
      if (cancelled) return;
      const next = toTokenInfo(metadata);
      if (!next) {
        setResolvedInfo({ key: assetKey, info: null });
        return;
      }
      setResolvedInfo({ key: assetKey, info: next });
    };

    const cached =
      metadataHint ?? getCachedTokenMetadataSync(chainId, tokenAddress);
    if (cached !== undefined) applyMetadata(cached);
    else setResolvedInfo({ key: assetKey, info: null });

    resolveTokenMetadataClient(chainId, tokenAddress).then(applyMetadata);
    return () => {
      cancelled = true;
    };
  }, [tokenAddress, chainId, native, metadataHint, assetKey]);

  // USD price resolution — uses the same cached CoinGecko handlers that power
  // the portfolio (5-min storage cache), so when a token is already in the
  // user's portfolio this is a free read.
  useEffect(() => {
    let cancelled = false;
    if (native) {
      const entry = CHAIN_REGISTRY.find((c) => c.chainId === chainId);
      const chainName = nativeInfo?.chainName ?? entry?.name;
      const nativeCurrencyName = nativeInfo?.name ?? entry?.nativeCurrency.name;
      const symbol = nativeInfo?.symbol ?? entry?.nativeCurrency.symbol;
      if (!chainName || !nativeCurrencyName || !symbol) return;
      chrome.runtime.sendMessage(
        {
          type: "resolveCoinGeckoNativeAssets",
          requests: [
            {
              chainId,
              chainName,
              nativeCurrencyName,
              symbol,
            },
          ],
        },
        (res: { success: boolean; data?: Array<{ priceUsd: number }> }) => {
          if (cancelled) return;
          const p = res?.data?.[0]?.priceUsd;
          if (p && p > 0) setPrice({ key: assetKey, usd: p });
        },
      );
    } else if (
      tokenAddress &&
      /^0x[a-fA-F0-9]{40}$/.test(tokenAddress)
    ) {
      chrome.runtime.sendMessage(
        {
          type: "resolveCoinGeckoErc20Prices",
          requests: [
            { chainId, contractAddress: tokenAddress.toLowerCase() },
          ],
        },
        (res: { success: boolean; data?: Array<{ priceUsd: number }> }) => {
          if (cancelled) return;
          const p = res?.data?.[0]?.priceUsd;
          if (p && p > 0) setPrice({ key: assetKey, usd: p });
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [tokenAddress, chainId, native, nativeInfo, assetKey]);

  // Friendly amount color: `fg.primary` (white in Midnight, black in Bauhaus).
  // Bumped to `lg` size — token amounts are the headline value the user needs
  // to see at a glance. Logo and symbol scale up alongside so the trio reads
  // as a single confident unit instead of three timid tokens.
  if (native) {
    const entry = CHAIN_REGISTRY.find((c) => c.chainId === chainId);
    const symbol =
      nativeInfo?.symbol || entry?.nativeCurrency.symbol || "ETH";
    const decimals =
      nativeInfo?.decimals ?? entry?.nativeCurrency.decimals ?? 18;
    const usd = formatUsdValue(amountRaw, decimals, priceUsd);
    return (
      <VStack spacing={0} align="flex-end" minW={0} maxW="full">
        <HStack
          spacing={0}
          gap={2}
          justify="flex-end"
          align="center"
          flexWrap="wrap"
          minW={0}
          maxW="full"
        >
          <AmountText
            amountRaw={amountRaw}
            decimals={decimals}
            symbol={symbol}
            thresholdRaw={thresholdRaw}
            thresholdMessage={thresholdMessage}
            allowUnlimited={allowUnlimited}
          />
          <TokenLogo
            nativeChainId={chainId}
            symbol={symbol}
            alt={symbol}
            size="20px"
          />
          <Text fontSize="sm" color="fg.secondary" fontWeight="600">
            {symbol}
          </Text>
        </HStack>
        {usd && (
          <Text
            fontSize="sm"
            color="fg.secondary"
            fontWeight="700"
            lineHeight="1.2"
            maxW="full"
            overflowWrap="anywhere"
            mt={0.5}
          >
            {usd}
          </Text>
        )}
      </VStack>
    );
  }

  if (!info) {
    return (
      <VStack align="end" spacing={1} maxW="full">
        <Text fontSize="sm" fontFamily="mono" color="fg.muted" maxW="full" overflowWrap="anywhere">
          {amountRaw} (base units)
        </Text>
        {tokenAddress && (
          <TokenContractPopover address={tokenAddress} explorer={explorer} symbol="Unknown">
            <Text fontSize="xs" fontFamily="mono">{tokenAddress.slice(0, 6)}…{tokenAddress.slice(-4)}</Text>
          </TokenContractPopover>
        )}
      </VStack>
    );
  }

  const usd = formatUsdValue(amountRaw, info.decimals, priceUsd);
  return (
    <VStack spacing={0} align="flex-end" minW={0} maxW="full">
      <HStack
        spacing={0}
        gap={2}
        justify="flex-end"
        align="center"
        flexWrap="wrap"
        minW={0}
        maxW="full"
      >
        <AmountText
          amountRaw={amountRaw}
          decimals={info.decimals}
          symbol={info.symbol}
          thresholdRaw={thresholdRaw}
          thresholdMessage={thresholdMessage}
          allowUnlimited={allowUnlimited}
        />
        {tokenAddress && /^0x[a-fA-F0-9]{40}$/.test(tokenAddress) ? (
          <TokenContractPopover
            address={tokenAddress}
            explorer={explorer}
            symbol={info.symbol}
          >
            <HStack spacing={2}>
              <TokenLogo
                logoUrl={info.logoUrl}
                symbol={info.symbol}
                alt={info.symbol}
                size="20px"
              />
              <Text fontSize="sm" color="inherit" fontWeight="600">
                {info.symbol}
              </Text>
            </HStack>
          </TokenContractPopover>
        ) : (
          <>
            <TokenLogo
              logoUrl={info.logoUrl}
              symbol={info.symbol}
              alt={info.symbol}
              size="20px"
            />
            <Text fontSize="sm" color="fg.secondary" fontWeight="600">
              {info.symbol}
            </Text>
          </>
        )}
      </HStack>
      {usd && (
        <Text fontSize="xs" color="fg.muted" fontWeight="500" maxW="full" overflowWrap="anywhere">
          {usd}
        </Text>
      )}
    </VStack>
  );
}
