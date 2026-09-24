/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import fs from "fs";
import { dirname, join } from "node:path";
import { findProjectRoot } from "../Utilities/Args";

export type PartialTpEventKind = "firstPartial" | "remainderClose" | "fullTp";

type DayBucket = {
  dayKey: string;
  firstPartial: number;
  remainderClose: number;
  fullTp: number;
  /** Sum of unrealized/realized pnl % samples on remainder closes (for avg). */
  remainderPnlSum: number;
  remainderPnlCount: number;
};

const runtimeBySymbol = new Map<string, DayBucket>();
let diskLoaded = false;

const utcDayKey = (ms: number = Date.now()): string => new Date(ms).toISOString().slice(0, 10);

const runtimeFilePath = (): string => join(findProjectRoot(), "settings", "partial-tp-runtime.json");

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
        firstPartial: Math.max(0, Math.floor(Number(val.firstPartial) || 0)),
        remainderClose: Math.max(0, Math.floor(Number(val.remainderClose) || 0)),
        fullTp: Math.max(0, Math.floor(Number(val.fullTp) || 0)),
        remainderPnlSum: Number(val.remainderPnlSum) || 0,
        remainderPnlCount: Math.max(0, Math.floor(Number(val.remainderPnlCount) || 0)),
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
    cur = {
      dayKey: today,
      firstPartial: 0,
      remainderClose: 0,
      fullTp: 0,
      remainderPnlSum: 0,
      remainderPnlCount: 0,
    };
    runtimeBySymbol.set(symbolKey, cur);
  }
  return cur;
};

export const recordPartialTpEvent = (
  symbolKey: string,
  kind: PartialTpEventKind,
  pnlPct?: number
): void => {
  const cur = entry(symbolKey);
  if (kind === "firstPartial") cur.firstPartial += 1;
  else if (kind === "remainderClose") {
    cur.remainderClose += 1;
    if (pnlPct != null && Number.isFinite(pnlPct)) {
      cur.remainderPnlSum += pnlPct;
      cur.remainderPnlCount += 1;
    }
  } else cur.fullTp += 1;
  persist();
};

export type PartialTpStatus = {
  firstPartialToday: number;
  remainderCloseToday: number;
  fullTpToday: number;
  avgRemainderPnlPct: number | null;
  /** first / (first+full) style split ratio when any TP activity */
  partialShare: number | null;
};

export const getPartialTpStatus = (symbolKey: string): PartialTpStatus => {
  const cur = entry(symbolKey);
  const avg =
    cur.remainderPnlCount > 0 ? cur.remainderPnlSum / cur.remainderPnlCount : null;
  const tpTotal = cur.firstPartial + cur.fullTp;
  return {
    firstPartialToday: cur.firstPartial,
    remainderCloseToday: cur.remainderClose,
    fullTpToday: cur.fullTp,
    avgRemainderPnlPct: avg != null ? Number(avg.toFixed(3)) : null,
    partialShare: tpTotal > 0 ? Number((cur.firstPartial / tpTotal).toFixed(3)) : null,
  };
};

export const resetPartialTpStats = (symbolKey?: string): void => {
  ensureLoaded();
  if (symbolKey) runtimeBySymbol.delete(symbolKey);
  else runtimeBySymbol.clear();
  persist();
};
