/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import fs from "fs";
import { dirname, join } from "node:path";
import { findProjectRoot } from "../Utilities/Args";

type DayBucket = {
  dayKey: string;
  blocked: number;
  buyIntoShort: number;
  sellIntoLong: number;
};

const runtimeBySymbol = new Map<string, DayBucket>();
let diskLoaded = false;

const utcDayKey = (ms: number = Date.now()): string => new Date(ms).toISOString().slice(0, 10);

const runtimeFilePath = (): string => join(findProjectRoot(), "settings", "counter-trend-runtime.json");

const ensureLoaded = (): void => {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const file = runtimeFilePath();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, DayBucket>;
    const today = utcDayKey();
    for (const [key, val] of Object.entries(parsed)) {
      if (!val || val.dayKey !== today) continue;
      runtimeBySymbol.set(key, {
        dayKey: val.dayKey,
        blocked: Math.max(0, Math.floor(Number(val.blocked) || 0)),
        buyIntoShort: Math.max(0, Math.floor(Number(val.buyIntoShort) || 0)),
        sellIntoLong: Math.max(0, Math.floor(Number(val.sellIntoLong) || 0)),
      });
    }
  } catch {
    /* ignore */
  }
};

const persist = (): void => {
  ensureLoaded();
  try {
    const file = runtimeFilePath();
    const dir = dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const out: Record<string, DayBucket> = {};
    for (const [k, v] of runtimeBySymbol) out[k] = v;
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
  } catch {
    /* ignore */
  }
};

const entry = (symbolKey: string): DayBucket => {
  ensureLoaded();
  const today = utcDayKey();
  let cur = runtimeBySymbol.get(symbolKey);
  if (!cur || cur.dayKey !== today) {
    cur = { dayKey: today, blocked: 0, buyIntoShort: 0, sellIntoLong: 0 };
    runtimeBySymbol.set(symbolKey, cur);
  }
  return cur;
};

export const recordCounterTrendBlock = (
  symbolKey: string,
  direction: string,
  trend: string
): void => {
  const cur = entry(symbolKey);
  cur.blocked += 1;
  if (direction === "BUY" && trend === "SHORT") cur.buyIntoShort += 1;
  if (direction === "SELL" && trend === "LONG") cur.sellIntoLong += 1;
  persist();
};

export type CounterTrendBlockStatus = {
  blockedToday: number;
  buyIntoShortToday: number;
  sellIntoLongToday: number;
};

export const getCounterTrendBlockStatus = (symbolKey: string): CounterTrendBlockStatus => {
  const cur = entry(symbolKey);
  return {
    blockedToday: cur.blocked,
    buyIntoShortToday: cur.buyIntoShort,
    sellIntoLongToday: cur.sellIntoLong,
  };
};

export const resetCounterTrendBlockStats = (symbolKey?: string): void => {
  ensureLoaded();
  if (symbolKey) runtimeBySymbol.delete(symbolKey);
  else runtimeBySymbol.clear();
  persist();
};
