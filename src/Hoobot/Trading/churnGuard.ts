/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import fs from "fs";
import { dirname, join } from "node:path";
import type { SymbolOptions } from "../Utilities/Args";
import { findProjectRoot } from "../Utilities/Args";
import { isAlgorithmicEntryTrade } from "./consecutiveLossGuard";

export type TradeRateLimitConfig = {
  enabled?: boolean;
  /** Max fills (entry+exit) per UTC day. 0 = unlimited. Default 16. */
  maxTradesPerDay?: number;
  /** Min minutes between algorithmic entries (BUY/SELL/SKIP). Default 12. */
  minMinutesBetweenEntries?: number;
};

type DayBucket = {
  dayKey: string;
  tradeCount: number;
  lastEntryAtMs: number;
};

const runtimeFilePath = (): string => join(findProjectRoot(), "settings", "trade-rate-runtime.json");
const runtimeBySymbol = new Map<string, DayBucket>();
let diskLoaded = false;

const utcDayKey = (ms: number = Date.now()): string => new Date(ms).toISOString().slice(0, 10);

const ensureLoaded = (): void => {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const RUNTIME_FILE = runtimeFilePath();
    if (!fs.existsSync(RUNTIME_FILE)) return;
    const raw = fs.readFileSync(RUNTIME_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, DayBucket>;
    const today = utcDayKey();
    for (const [key, val] of Object.entries(parsed)) {
      if (!val || typeof val !== "object") continue;
      if (val.dayKey !== today) continue;
      runtimeBySymbol.set(key, {
        dayKey: val.dayKey,
        tradeCount: Math.max(0, Math.floor(Number(val.tradeCount) || 0)),
        lastEntryAtMs: Number(val.lastEntryAtMs) || 0,
      });
    }
  } catch {
    /* ignore */
  }
};

const persist = (): void => {
  ensureLoaded();
  try {
    const RUNTIME_FILE = runtimeFilePath();
    const dir = dirname(RUNTIME_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const out: Record<string, DayBucket> = {};
    for (const [k, v] of runtimeBySymbol) out[k] = v;
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(out, null, 2));
  } catch {
    /* ignore */
  }
};

const entry = (symbolKey: string): DayBucket => {
  ensureLoaded();
  const today = utcDayKey();
  let cur = runtimeBySymbol.get(symbolKey);
  if (!cur || cur.dayKey !== today) {
    cur = { dayKey: today, tradeCount: 0, lastEntryAtMs: 0 };
    runtimeBySymbol.set(symbolKey, cur);
  }
  return cur;
};

export const resolveTradeRateLimitConfig = (symbolOptions: SymbolOptions): Required<TradeRateLimitConfig> => {
  const raw = symbolOptions.tradeRateLimit;
  const enabled = raw?.enabled !== false;
  const maxRaw = Number(raw?.maxTradesPerDay);
  const minRaw = Number(raw?.minMinutesBetweenEntries);
  return {
    enabled,
    maxTradesPerDay: Number.isFinite(maxRaw) && maxRaw >= 0 ? maxRaw : 16,
    minMinutesBetweenEntries: Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : 12,
  };
};

export type TradeRateStatus = {
  active: boolean;
  reason?: "maxTradesPerDay" | "minMinutesBetweenEntries";
  tradeCountToday: number;
  maxTradesPerDay: number;
  minutesSinceLastEntry: number | null;
  minMinutesBetweenEntries: number;
};

export const getTradeRateStatus = (symbolKey: string, symbolOptions: SymbolOptions): TradeRateStatus => {
  const cfg = resolveTradeRateLimitConfig(symbolOptions);
  const cur = entry(symbolKey);
  const now = Date.now();
  const minutesSince =
    cur.lastEntryAtMs > 0 ? (now - cur.lastEntryAtMs) / 60000 : null;
  let active = false;
  let reason: TradeRateStatus["reason"];
  if (cfg.enabled) {
    if (cfg.maxTradesPerDay > 0 && cur.tradeCount >= cfg.maxTradesPerDay) {
      active = true;
      reason = "maxTradesPerDay";
    } else if (
      cfg.minMinutesBetweenEntries > 0 &&
      minutesSince != null &&
      minutesSince < cfg.minMinutesBetweenEntries
    ) {
      active = true;
      reason = "minMinutesBetweenEntries";
    }
  }
  return {
    active,
    reason,
    tradeCountToday: cur.tradeCount,
    maxTradesPerDay: cfg.maxTradesPerDay,
    minutesSinceLastEntry: minutesSince != null ? Math.floor(minutesSince) : null,
    minMinutesBetweenEntries: cfg.minMinutesBetweenEntries,
  };
};

/** Call after a successful live/sim fill (any side). */
export const recordTradeFillForRateLimit = (symbolKey: string): void => {
  const cur = entry(symbolKey);
  cur.tradeCount += 1;
  persist();
};

/** Call when an algorithmic entry (BUY/SELL/SKIP open) is placed successfully. */
export const recordEntryForRateLimit = (symbolKey: string): void => {
  const cur = entry(symbolKey);
  cur.lastEntryAtMs = Date.now();
  persist();
};

/**
 * Blocks algorithmic entries when daily trade count or entry spacing is exceeded.
 * STOP_LOSS / TAKE_PROFIT closes are never blocked by rate limit.
 */
export const shouldBlockTradeRateLimitEntry = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  direction: string,
  profit: string
): boolean => {
  const cfg = resolveTradeRateLimitConfig(symbolOptions);
  if (!cfg.enabled || !isAlgorithmicEntryTrade(direction, profit)) return false;
  return getTradeRateStatus(symbolKey, symbolOptions).active;
};

export const resetTradeRateLimit = (symbolKey?: string): void => {
  ensureLoaded();
  if (symbolKey) runtimeBySymbol.delete(symbolKey);
  else runtimeBySymbol.clear();
  persist();
};
