/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

export type StopLossAtrConfig = {
  atrScale?: boolean;
  atrMultiplier?: number;
  atrMin?: number;
  atrMax?: number;
};

/** Viimeisin ATR / close × 100 (%). */
export const atrPctFromSeries = (
  atrSeries: number[] | undefined,
  closePrice: number,
  lookback = 48
): number | undefined => {
  if (!atrSeries?.length || !(closePrice > 0)) return undefined;
  const tail = atrSeries.slice(-Math.min(lookback, atrSeries.length));
  const last = tail[tail.length - 1];
  if (!Number.isFinite(last) || last <= 0) return undefined;
  return (last / closePrice) * 100;
};

/**
 * Skaalaa negatiivinen SL-kynnys ATR:n mukaan volatiliteetissa leveämmäksi.
 * Käyttäjän stopLoss.pnl on aina lattia (ei koskaan tiukempi kuin asetettu).
 * atrMin/atrMax rajaavat vain ATR-skaalattua osaa.
 */
export const effectiveStopLossPnl = (
  basePnl: number,
  atrPct: number | undefined,
  cfg?: StopLossAtrConfig
): number => {
  const base = Number.isFinite(basePnl) ? basePnl : 0;
  if (base >= 0) return 0;
  if (cfg?.atrScale !== true || atrPct == null || !Number.isFinite(atrPct) || atrPct <= 0) {
    return base;
  }
  const mult = Number.isFinite(cfg.atrMultiplier) && (cfg.atrMultiplier ?? 0) > 0 ? cfg.atrMultiplier! : 1.5;
  const minAbs = Number.isFinite(cfg.atrMin) && (cfg.atrMin ?? 0) > 0 ? cfg.atrMin! : 0.4;
  const maxAbs = Number.isFinite(cfg.atrMax) && (cfg.atrMax ?? 0) > 0 ? cfg.atrMax! : 2.5;
  const volScaledAbs = Math.min(maxAbs, Math.max(minAbs, atrPct * mult));
  // Leveämpi (negatiivisempi) voittaa; base estää atrMax:ia kiristämästä alle käyttäjän pnl:n.
  return Math.min(base, -volScaledAbs);
};
