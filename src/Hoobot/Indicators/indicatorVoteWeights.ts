/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { SymbolOptions } from "../Utilities/Args";

/** Snapshot of configured indicator weights before per-tick signal boosts. */
export type IndicatorWeightSnapshot = {
  sma?: number;
  ema?: number;
  adx?: number;
  macd?: number;
  rsi?: number;
  so?: number;
  srsi?: number;
  bb?: number;
  obv?: number;
  cmf?: number;
  renko?: number;
  dmi?: number;
};

export const snapshotIndicatorWeights = (
  indicators: SymbolOptions["indicators"]
): IndicatorWeightSnapshot | null => {
  if (!indicators) return null;
  return {
    sma: indicators.sma?.weight,
    ema: indicators.ema?.weight,
    adx: indicators.adx?.weight,
    macd: indicators.macd?.weight,
    rsi: indicators.rsi?.weight,
    so: indicators.so?.weight,
    srsi: indicators.srsi?.weight,
    bb: indicators.bb?.weight,
    obv: indicators.obv?.weight,
    cmf: indicators.cmf?.weight,
    renko: indicators.renko?.weight,
    dmi: indicators.dmi?.weight,
  };
};

const applyWeight = (target: { weight?: number } | undefined, value: number | undefined): void => {
  if (!target) return;
  if (value !== undefined) {
    target.weight = value;
  } else {
    delete target.weight;
  }
};

export const restoreIndicatorWeights = (
  indicators: SymbolOptions["indicators"],
  snap: IndicatorWeightSnapshot | null
): void => {
  if (!indicators || !snap) return;
  applyWeight(indicators.sma, snap.sma);
  applyWeight(indicators.ema, snap.ema);
  applyWeight(indicators.adx, snap.adx);
  applyWeight(indicators.macd, snap.macd);
  applyWeight(indicators.rsi, snap.rsi);
  applyWeight(indicators.so, snap.so);
  applyWeight(indicators.srsi, snap.srsi);
  applyWeight(indicators.bb, snap.bb);
  applyWeight(indicators.obv, snap.obv);
  applyWeight(indicators.cmf, snap.cmf);
  applyWeight(indicators.renko, snap.renko);
  applyWeight(indicators.dmi, snap.dmi);
};
