/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Exchange } from "../Hoobot/Exchanges/Exchange";
import { annotateTradesWithTriggers } from "../Hoobot/Trading/tradeTriggers";
import type { Trade } from "../Hoobot/Exchanges/Trades";
import {
  calculatePNLPercentageForLong,
  calculatePNLPercentageForShort,
  getTradeHistory,
} from "../Hoobot/Exchanges/Trades";
import { resolveOpenPositionEntryTrade } from "../Hoobot/Trading/positionState";
import { applyFeeAdjustmentToPnl } from "../Hoobot/Trading/tradeGates";
import type { CandlestickInterval, ConfigOptions, ExchangeOptions } from "../Hoobot/Utilities/Args";
import { toSymbolKey } from "../Hoobot/Utilities/Args";

export const computeStaleExitStatus = (
  forcedExit: { enabled?: boolean; maxHours?: number } | undefined,
  lastTradeTime: number | undefined,
  hasOpenPosition: boolean,
  nowMs = Date.now()
): {
  enabled: boolean;
  maxHours?: number;
  ageHours?: number;
  remainingHours?: number;
} => {
  const maxHours = Number(forcedExit?.maxHours);
  const enabled = forcedExit?.enabled !== false && Number.isFinite(maxHours) && maxHours > 0;
  const ageHours =
    hasOpenPosition && lastTradeTime != null && Number.isFinite(lastTradeTime)
      ? Math.max(0, (nowMs - lastTradeTime) / 3_600_000)
      : undefined;
  const remainingHours = enabled && ageHours != null ? Math.max(0, maxHours - ageHours) : undefined;
  return {
    enabled,
    maxHours: enabled ? maxHours : undefined,
    ageHours: ageHours != null ? Number(ageHours.toFixed(2)) : undefined,
    remainingHours: remainingHours != null ? Number(remainingHours.toFixed(2)) : undefined,
  };
};

export const getTargetTimestamp = (duration: string): number => {
  const now = Math.floor(new Date().getTime() / 1000);
  switch (duration.toUpperCase()) {
    case "1D":
      return now - 24 * 60 * 60;
    case "1W":
      return now - 7 * 24 * 60 * 60;
    case "1M":
      return now - 30 * 24 * 60 * 60;
    case "1Y":
      return now - 30 * 24 * 60 * 60 * 12;
    default:
      throw new Error("Invalid duration");
  }
};

export const durationToChartInterval = (duration: string): CandlestickInterval => {
  switch (duration.toUpperCase()) {
    case "1D":
      return "5m";
    case "1W":
      return "1h";
    case "1M":
      return "4h";
    case "1Y":
      return "1d";
    default:
      return "5m";
  }
};

export const candleLimitForDuration = (duration: string): number => {
  switch (duration.toUpperCase()) {
    case "1D":
      return 288;
    case "1W":
      return 168;
    case "1M":
      return 180;
    case "1Y":
      return 365;
    default:
      return 288;
  }
};

export type DashboardExchangeResolver = (
  exchangeName: string
) => Promise<
  { exchange: Exchange; exchangeOptions: ExchangeOptions } | { error: string; status: number }
>;

export const tradesForSymbolInDuration = (
  exchangeOptions: ExchangeOptions,
  symbolName: string,
  duration: string
): Trade[] => {
  const symbolKey = toSymbolKey(symbolName);
  const targetMs = getTargetTimestamp(duration.toUpperCase()) * 1000;
  const history = exchangeOptions.tradeHistory?.[symbolKey] ?? [];
  return history.filter((t) => t.time >= targetMs);
};

export const netUnrealizedPctAtMark = (
  entryPrice: number,
  markPrice: number,
  side: "LONG" | "SHORT",
  tradeFeePercentage?: number,
  lastTrade?: Trade
): number => {
  const gross =
    side === "LONG"
      ? calculatePNLPercentageForLong(entryPrice, markPrice)
      : calculatePNLPercentageForShort(entryPrice, markPrice);
  return applyFeeAdjustmentToPnl(gross, tradeFeePercentage, lastTrade);
};

export type OpenPositionSnapshot = {
  open: boolean;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  entryTime?: number;
  unrealizedPct?: number;
  markPrice?: number;
};

export const computeOpenPositionSnapshot = (
  trades: Trade[],
  markPrice: number | undefined,
  tradeFeePercentage?: number,
  symbolKey?: string
): OpenPositionSnapshot => {
  const entry = resolveOpenPositionEntryTrade(trades, symbolKey);
  if (!entry || trades.length === 0 || markPrice == null) {
    return { open: false };
  }
  const entryPrice = parseFloat(entry.price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { open: false };
  const side: "LONG" | "SHORT" = entry.isBuyer ? "LONG" : "SHORT";
  const unrealizedPct = netUnrealizedPctAtMark(entryPrice, markPrice, side, tradeFeePercentage, entry);
  return {
    open: true,
    side: entry.isBuyer ? "LONG" : "SHORT",
    entryPrice: entryPrice,
    entryTime: entry.time,
    unrealizedPct: Number(unrealizedPct.toFixed(3)),
    markPrice,
  };
};

export const loadTradesForChart = async (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions,
  symbol: string,
  duration: string
): Promise<Trade[]> => {
  const targetMs = getTargetTimestamp(duration) * 1000;
  let trades = tradesForSymbolInDuration(exchangeOptions, symbol, duration);
  if (trades.length === 0) {
    const history = await getTradeHistory(exchange, symbol);
    trades = history.filter((t) => t.time >= targetMs);
  }
  return annotateTradesWithTriggers(symbol, trades);
};

export type DashboardRouteDeps = {
  options: ConfigOptions;
  isSimulateInstance: boolean;
  resolveDashboardExchange: DashboardExchangeResolver;
  pnlCacheByKey: Record<string, { at: number; data: unknown }>;
  priceChartCacheByKey: Record<string, { at: number; data: unknown }>;
  PNL_CACHE_MS: number;
  PRICE_CHART_CACHE_MS: number;
  roundTripPnlAfterFees: (
    gross: number,
    older: Trade,
    last: Trade,
    fee?: number
  ) => number;
  logger: { error: (...args: unknown[]) => void };
};
