/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { SymbolOptions } from "../Utilities/Args";

/** Live Binance: limit @ bid/ask, aggressiveLimit @ ask/bid-premium, market = marketBuy/marketSell. */
export type LiveOrderExecutionMode = "limit" | "aggressiveLimit" | "market";

export type LiveOrderExecutionConfig = {
  buy?: LiveOrderExecutionMode;
  sell?: LiveOrderExecutionMode;
};

export const LIVE_ORDER_EXECUTION_MODES: readonly LiveOrderExecutionMode[] = [
  "limit",
  "aggressiveLimit",
  "market",
];

export const isLiveOrderExecutionMode = (v: unknown): v is LiveOrderExecutionMode =>
  v === "limit" || v === "aggressiveLimit" || v === "market";

const isMode = isLiveOrderExecutionMode;

/** Strips invalid buy/sell values; logs warnings for bad config. */
export const normalizeLiveOrderExecution = (
  symbolName: string,
  config: LiveOrderExecutionConfig | undefined
): LiveOrderExecutionConfig | undefined => {
  if (!config || typeof config !== "object") return undefined;
  const out: LiveOrderExecutionConfig = {};
  const warnInvalid = (side: "buy" | "sell", value: unknown): void => {
    console.warn(
      `[Hoobot] ${symbolName}: liveOrderExecution.${side} invalid (${String(value)}) — use limit, aggressiveLimit, or market.`
    );
  };
  if (config.buy !== undefined) {
    if (isMode(config.buy)) out.buy = config.buy;
    else warnInvalid("buy", config.buy);
  }
  if (config.sell !== undefined) {
    if (isMode(config.sell)) out.sell = config.sell;
    else warnInvalid("sell", config.sell);
  }
  return out.buy !== undefined || out.sell !== undefined ? out : undefined;
};

export const resolveLiveBuyOrderMode = (symbolOptions: SymbolOptions, profit: string): LiveOrderExecutionMode => {
  if (profit === "GRID") return "limit";
  if (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") return "limit";
  if (profit === "STALE_EXIT" || profit === "STOP_LOSS") return "market";
  const configured = symbolOptions.liveOrderExecution?.buy;
  if (isMode(configured)) return configured;
  if (profit === "SKIP" || profit === "BUY") return "aggressiveLimit";
  return "limit";
};

export const resolveLiveSellOrderMode = (symbolOptions: SymbolOptions, profit: string): LiveOrderExecutionMode => {
  if (profit === "GRID") return "limit";
  if (profit === "STOP_LOSS" || profit === "TAKE_PROFIT_FORCE" || profit === "STALE_EXIT") return "market";
  // Trailing TP: always limit so sell:market (SL) does not clip the high.
  if (profit === "TAKE_PROFIT") return "limit";
  const configured = symbolOptions.liveOrderExecution?.sell;
  if (isMode(configured)) return configured;
  return "limit";
};

export const liveBuyUsesAggressiveLimitPricing = (mode: LiveOrderExecutionMode): boolean => mode === "aggressiveLimit";

export const liveOrderFollowUpDelayMs = (mode: LiveOrderExecutionMode): number =>
  mode === "market" ? 2500 : 30000;
