/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { SymbolOptions } from "../Utilities/Args";
import { shouldBlockConsecutiveLossEntry, shouldBlockStopLossCooldownEntry } from "./consecutiveLossGuard";
import { shouldBlockTradeRateLimitEntry } from "./churnGuard";
import { isSymbolCandleStale } from "../Utilities/botHealth";

export type MayExecuteAlgorithmicTradeOptions = {
  /** Kun false, profit SKIP sallitaan avauskaupassa (ei tradeHistoryä vielä). */
  hasTradeHistory?: boolean;
  /** Avoin long-positio — TP-sulku sallitaan SL-cooldownin aikana. */
  hasOpenPosition?: boolean;
  symbolKey?: string;
  symbolOptions?: SymbolOptions;
  /** Estä entryt jos candle-stream on vanhentunut (oletus true live). */
  blockStaleCandles?: boolean;
};

/** Sama profit+direction -suodatin kuin live placeTrade (ei HOLD). */
export const mayExecuteAlgorithmicTrade = (
  profit: string,
  direction: string,
  opts?: MayExecuteAlgorithmicTradeOptions
): boolean => {
  const hasTradeHistory = opts?.hasTradeHistory ?? false;
  const allowSkipEntry = !hasTradeHistory && profit === "SKIP";

  const isTakeProfitClose = profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE";
  const isForcedClose = profit === "STOP_LOSS" || profit === "STALE_EXIT" || isTakeProfitClose;
  let allowed = false;
  if (direction === "SELL") {
    allowed = profit === "SELL" || isForcedClose || allowSkipEntry;
  } else if (direction === "BUY") {
    allowed = profit === "BUY" || isForcedClose || allowSkipEntry;
  }
  if (!allowed) return false;

  const symbolKey = opts?.symbolKey;
  const symbolOptions = opts?.symbolOptions;
  if (symbolKey && symbolOptions) {
    if (
      shouldBlockStopLossCooldownEntry(
        symbolKey,
        symbolOptions,
        direction,
        profit,
        opts?.hasOpenPosition === true
      )
    ) {
      return false;
    }
    if (shouldBlockConsecutiveLossEntry(symbolKey, symbolOptions, direction, profit)) {
      return false;
    }
    if (shouldBlockTradeRateLimitEntry(symbolKey, symbolOptions, direction, profit)) {
      return false;
    }
    const blockStale = opts?.blockStaleCandles !== false;
    if (
      blockStale &&
      profit !== "STOP_LOSS" &&
      profit !== "TAKE_PROFIT" &&
      profit !== "TAKE_PROFIT_FORCE" &&
      profit !== "STALE_EXIT" &&
      isSymbolCandleStale(symbolKey)
    ) {
      return false;
    }
  }
  return true;
};

/** Sim fee % per leg (round-trip käytetään erikseen PnL:ssä). */
export const simFeeRatePerLeg = (tradeFeePercentage?: number): number => {
  const pct = tradeFeePercentage ?? 0.075;
  return pct / 100;
};

/** PnL-prosenttipisteet vähennettäväksi (round-trip); sama oletus kuin simFeeRatePerLeg. */
export const roundTripFeePctPoints = (tradeFeePercentage?: number): number => {
  return (tradeFeePercentage ?? 0.075) * 2;
};

export type TradeFeeCommissionHint = {
  commission?: string;
  quoteQty?: string;
  commissionAsset?: string;
  symbol?: string;
};

const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "EUR", "GBP", "BRL", "USD", "BTC", "ETH", "BNB"] as const;

/** Pairin quote-asset (BTCEUR → EUR). */
export const quoteAssetFromSymbol = (symbol?: string): string | undefined => {
  if (!symbol) return undefined;
  const s = symbol.replace("/", "").toUpperCase();
  for (const q of KNOWN_QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return q;
  }
  return undefined;
};

/**
 * Todellinen komissio prosenttipisteinä (notionalin suhteen).
 * BNB- tai base-asset -komissio / quoteQty antaisi väärän ~0 %:n — ohita ja käytä tradeFeePercentage.
 */
export const commissionPctPointsFromTrade = (trade?: TradeFeeCommissionHint): number => {
  if (!trade) return 0;
  const comm = parseFloat(String(trade.commission ?? ""));
  const quoteQty = parseFloat(String(trade.quoteQty ?? ""));
  if (!Number.isFinite(comm) || comm <= 0) return 0;
  if (!Number.isFinite(quoteQty) || quoteQty <= 0) return 0;
  const asset = String(trade.commissionAsset ?? "").toUpperCase();
  const quote = quoteAssetFromSymbol(trade.symbol);
  if (asset && quote && asset !== quote) return 0;
  if (asset === "BNB" && quote !== "BNB") return 0;
  const pct = (comm / quoteQty) * 100;
  if (pct < 0.01 || pct > 0.5) return 0;
  return pct;
};

/**
 * Unrealized / avoin positio: vähennä round-trip tai vain sulku + jo maksettu avaus
 * (jos commission on jo tradeHistoryssä).
 */
export const feePctPointsToSubtractFromPnl = (
  tradeFeePercentage?: number,
  lastTrade?: TradeFeeCommissionHint
): number => {
  const legDefault = tradeFeePercentage ?? 0.075;
  const openLeg = commissionPctPointsFromTrade(lastTrade);
  if (openLeg > 0) return openLeg + legDefault;
  return legDefault * 2;
};

export const applyFeeAdjustmentToPnl = (
  pnl: number,
  tradeFeePercentage?: number,
  lastTrade?: TradeFeeCommissionHint
): number => {
  return pnl - feePctPointsToSubtractFromPnl(tradeFeePercentage, lastTrade);
};

/** Suljettu round-trip kahden kaupan välillä: käytä todellisia komissioita tai arvio. */
export const roundTripPnlAfterFees = (
  grossPnlPct: number,
  olderTrade: TradeFeeCommissionHint,
  lastTrade: TradeFeeCommissionHint,
  tradeFeePercentage?: number
): number => {
  const leg = tradeFeePercentage ?? 0.075;
  const olderFee = commissionPctPointsFromTrade(olderTrade);
  const lastFee = commissionPctPointsFromTrade(lastTrade);
  const feePoints = (olderFee > 0 ? olderFee : leg) + (lastFee > 0 ? lastFee : leg);
  return grossPnlPct - feePoints;
};

const DEFAULT_MAX_ENTRY_SLIPPAGE_PCT = 0.1;

/** Estä entry-osto jos limit-hinta on selvästi orderbook-midin yläpuolella (slippage + yksi fee-leg). */
export const liveEntryBuyPriceAcceptable = (
  roundedPrice: number,
  orderBook: { bids?: Record<string, number>; asks?: Record<string, number> },
  tradeFeePercentage: number | undefined,
  profit: string
): boolean => {
  if (profit === "STOP_LOSS" || profit === "GRID") return true;
  const bids = Object.keys(orderBook.bids ?? {})
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => b - a);
  const asks = Object.keys(orderBook.asks ?? {})
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  const bid = bids[0];
  const ask = asks[0];
  if (!bid || !ask) return true;
  const mid = (bid + ask) / 2;
  const feeLeg = (tradeFeePercentage ?? 0.075) / 100;
  const maxPrice = mid * (1 + feeLeg + DEFAULT_MAX_ENTRY_SLIPPAGE_PCT / 100);
  return roundedPrice <= maxPrice;
};
