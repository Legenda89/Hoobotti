/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Candlestick } from "../Exchanges/Candlesticks";

type CacheRow = { fingerprint: string; value: unknown };

const indicatorCalcCache = new Map<string, CacheRow>();

export const buildCandleSeriesFingerprint = (series: Candlestick[] | undefined): string => {
  if (!series?.length) return "empty";
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : undefined;
  return [
    series.length,
    last.startTime ?? last.time ?? 0,
    last.open,
    last.high,
    last.low,
    last.close,
    last.isFinal ? 1 : 0,
    prev?.close ?? "",
  ].join(":");
};

export const buildIndicatorsCalcFingerprint = (opts: {
  symbolKey: string;
  timeframes: string[];
  trendTimeframe?: string;
  seriesByTf: Record<string, Candlestick[] | undefined>;
}): string => {
  const parts: string[] = [opts.symbolKey];
  for (const tf of opts.timeframes) {
    parts.push(tf, buildCandleSeriesFingerprint(opts.seriesByTf[tf]));
  }
  if (opts.trendTimeframe) {
    parts.push("trend", opts.trendTimeframe, buildCandleSeriesFingerprint(opts.seriesByTf[opts.trendTimeframe]));
  }
  return parts.join("|");
};

export const getCachedIndicatorCalc = <T>(cacheKey: string, fingerprint: string): T | undefined => {
  const row = indicatorCalcCache.get(cacheKey);
  if (!row || row.fingerprint !== fingerprint) return undefined;
  return JSON.parse(JSON.stringify(row.value)) as T;
};

export const setCachedIndicatorCalc = <T>(cacheKey: string, fingerprint: string, value: T): void => {
  indicatorCalcCache.set(cacheKey, {
    fingerprint,
    value: JSON.parse(JSON.stringify(value)),
  });
};

export const clearIndicatorCalcCache = (): void => {
  indicatorCalcCache.clear();
};
