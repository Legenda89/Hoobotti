/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

export type SymbolWsHealth = {
  symbol: string;
  candleStreams: string[];
  subscribedAt?: string;
  lastCandleAt?: string;
  lastCandleAgeSec?: number;
  stale?: boolean;
  lastError?: string;
  lastErrorAt?: string;
};

const healthBySymbol = new Map<string, SymbolWsHealth>();

/** Default: block new entries if no candle for this long (ms). */
export const DEFAULT_STALE_CANDLE_MS = 5 * 60 * 1000;

export const markSymbolCandleSubscribed = (symbol: string, intervals: string[]): void => {
  const key = symbol.replace(/\//g, "");
  const prev = healthBySymbol.get(key);
  healthBySymbol.set(key, {
    symbol,
    candleStreams: [...intervals],
    subscribedAt: new Date().toISOString(),
    lastCandleAt: prev?.lastCandleAt,
    lastError: prev?.lastError,
    lastErrorAt: prev?.lastErrorAt,
  });
};

export const markSymbolCandleUpdate = (symbol: string): void => {
  const key = symbol.replace(/\//g, "");
  const prev = healthBySymbol.get(key) ?? { symbol, candleStreams: [] };
  healthBySymbol.set(key, {
    ...prev,
    lastCandleAt: new Date().toISOString(),
  });
};

export const markSymbolWsError = (symbol: string, message: string): void => {
  const key = symbol.replace(/\//g, "");
  const prev = healthBySymbol.get(key) ?? { symbol, candleStreams: [] };
  healthBySymbol.set(key, {
    ...prev,
    lastError: message,
    lastErrorAt: new Date().toISOString(),
  });
};

export const isSymbolCandleStale = (
  symbol: string,
  maxAgeMs: number = DEFAULT_STALE_CANDLE_MS
): boolean => {
  const key = symbol.replace(/\//g, "");
  const row = healthBySymbol.get(key);
  if (!row?.lastCandleAt) {
    // Subscribed but never received — treat as stale after subscribe grace (90s).
    if (row?.subscribedAt) {
      const subAge = Date.now() - new Date(row.subscribedAt).getTime();
      return subAge > 90_000;
    }
    return false;
  }
  const age = Date.now() - new Date(row.lastCandleAt).getTime();
  return age > maxAgeMs;
};

export const getSymbolWsHealthSnapshot = (): SymbolWsHealth[] => {
  const now = Date.now();
  return [...healthBySymbol.entries()].map(([key, h]) => {
    const lastMs = h.lastCandleAt ? new Date(h.lastCandleAt).getTime() : undefined;
    const ageSec = lastMs != null ? Math.floor((now - lastMs) / 1000) : undefined;
    return {
      ...h,
      lastCandleAgeSec: ageSec,
      stale: isSymbolCandleStale(key),
    };
  });
};

export const resetBotHealth = (): void => {
  healthBySymbol.clear();
};
