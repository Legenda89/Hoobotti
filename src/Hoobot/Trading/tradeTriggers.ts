/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "node:path";
import type { Trade } from "../Exchanges/Trades";
import { toSymbolKey, findProjectRoot } from "../Utilities/Args";

type TriggerEntry = {
  profit: string;
  time: number;
  orderId?: string;
};

/** symbolKey -> newest-first trigger hints (matched by orderId or nearest time). */
type TriggerStore = Record<string, TriggerEntry[]>;

const MAX_PER_SYMBOL = 200;

const storePath = (): string => {
  try {
    return join(findProjectRoot(), "settings", "trade-triggers.json");
  } catch {
    return join(process.cwd(), "settings", "trade-triggers.json");
  }
};

let memory: TriggerStore | null = null;

const loadStore = (): TriggerStore => {
  if (memory) return memory;
  try {
    const p = storePath();
    if (!existsSync(p)) {
      memory = {};
      return memory;
    }
    const raw = readFileSync(p, "utf-8");
    memory = (raw ? JSON.parse(raw) : {}) as TriggerStore;
    if (!memory || typeof memory !== "object") memory = {};
  } catch {
    memory = {};
  }
  return memory;
};

const persistStore = (): void => {
  try {
    const p = storePath();
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(memory ?? {}, null, 2));
  } catch (e) {
    console.warn("[tradeTriggers] persist failed:", e);
  }
};

export const recordTradeTrigger = (
  symbol: string,
  profit: string,
  opts?: { orderId?: string | number; time?: number }
): void => {
  if (!profit || profit === "SKIP" || profit === "GRID") return;
  const key = toSymbolKey(symbol);
  const store = loadStore();
  if (!store[key]) store[key] = [];
  const entry: TriggerEntry = {
    profit: String(profit),
    time: opts?.time ?? Date.now(),
    orderId: opts?.orderId != null ? String(opts.orderId) : undefined,
  };
  store[key].unshift(entry);
  if (store[key].length > MAX_PER_SYMBOL) {
    store[key] = store[key].slice(0, MAX_PER_SYMBOL);
  }
  persistStore();
};

const matchTrigger = (list: TriggerEntry[], trade: Trade): string | undefined => {
  const oid = trade.orderId != null ? String(trade.orderId) : "";
  if (oid) {
    const byId = list.find((e) => e.orderId && e.orderId === oid);
    if (byId) return byId.profit;
  }
  const t = trade.time;
  if (!Number.isFinite(t)) return undefined;
  // Prefer orderId; time fallback only for entries that also lack orderId (max 30s).
  let best: TriggerEntry | undefined;
  let bestDelta = Infinity;
  for (const e of list) {
    if (e.orderId) continue;
    const d = Math.abs(e.time - t);
    if (d < bestDelta && d <= 30_000) {
      bestDelta = d;
      best = e;
    }
  }
  return best?.profit;
};

/** Merge persisted triggers onto exchange trade history (mutates copies). */
export const annotateTradesWithTriggers = (symbol: string, trades: Trade[]): Trade[] => {
  if (!trades.length) return trades;
  const list = loadStore()[toSymbolKey(symbol)] ?? [];
  if (!list.length) return trades;
  return trades.map((t) => {
    if (t.profit && String(t.profit).trim() !== "") return t;
    const profit = matchTrigger(list, t);
    return profit ? { ...t, profit } : t;
  });
};
