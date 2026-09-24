/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { SymbolOptions } from "../Utilities/Args";

export const resolveMacdParams = (symbolOptions: SymbolOptions): { fast: number; slow: number; signal: number } => {
  const m = symbolOptions.indicators?.macd;
  const fast = Number(m?.fast);
  const slow = Number(m?.slow);
  const signal = Number(m?.signal);
  return {
    fast: Number.isFinite(fast) && fast > 0 ? Math.floor(fast) : 12,
    slow: Number.isFinite(slow) && slow > 0 ? Math.floor(slow) : 26,
    signal: Number.isFinite(signal) && signal > 0 ? Math.floor(signal) : 9,
  };
};

export const resolvePositiveInt = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function normalizeAlgorithmicIndicatorParams(sym: SymbolOptions): void {
  const ind = sym.indicators;
  if (!ind) return;
  if (ind.macd) {
    const p = resolveMacdParams(sym);
    ind.macd.fast = p.fast;
    ind.macd.slow = p.slow;
    ind.macd.signal = p.signal;
  }
  if (ind.rsi) {
    ind.rsi.length = resolvePositiveInt(ind.rsi.length, 14);
    if (!ind.rsi.smoothing) ind.rsi.smoothing = { type: "EMA", length: 14 };
    ind.rsi.smoothing.length = resolvePositiveInt(ind.rsi.smoothing.length, 14);
    ind.rsi.history = resolvePositiveInt(ind.rsi.history, 3);
  }
  if (ind.adx) {
    ind.adx.dilength = resolvePositiveInt(ind.adx.dilength, 14);
    ind.adx.adxSmoothing = resolvePositiveInt(ind.adx.adxSmoothing, 14);
  }
  if (ind.bb) {
    ind.bb.length = resolvePositiveInt(ind.bb.length, 20);
    const mult = Number(ind.bb.multiplier);
    ind.bb.multiplier = Number.isFinite(mult) && mult > 0 ? mult : 2;
    if (ind.bb.average !== "EMA") ind.bb.average = "SMA";
  }
  if (ind.cmf) {
    ind.cmf.length = resolvePositiveInt(ind.cmf.length, 20);
    ind.cmf.history = resolvePositiveInt(ind.cmf.history, 3);
  }
  if (ind.atr) {
    ind.atr.length = resolvePositiveInt(ind.atr.length, 14);
  }
}
