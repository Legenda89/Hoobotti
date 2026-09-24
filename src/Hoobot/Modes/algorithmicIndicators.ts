/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/**
 * Algorithmic indicator paradigms — pick ONE voting style to avoid mean-reversion vs momentum conflict.
 * - meanReversion: RSI + BB + CMF (scout: rsi, bb)
 * - meanReversionVolatile: wider RSI/BB thresholds for volatile pairs (XRP etc.)
 * - momentum: MACD + ADX + CMF (scout: macd)
 * - complementary: legacy mixed set (not recommended for live)
 * - custom: do not overwrite on load
 */

import type { SymbolOptions } from "../Utilities/Args";

export type IndicatorsPreset =
  | "meanReversion"
  | "meanReversionVolatile"
  | "momentum"
  | "complementary"
  | "custom";

type IndicatorBlock = NonNullable<SymbolOptions["indicators"]>;

const off = { enabled: false as const };

const baseOffBlocks = (): Pick<
  IndicatorBlock,
  "sma" | "renko" | "ema" | "obv" | "so" | "srsi" | "dmi" | "OpenAI" | "atr"
> => ({
  sma: { ...off, length: 7, weight: 0 },
  renko: { ...off, weight: 0, multiplier: 1, brickSize: 0 },
  ema: { ...off, short: 9, long: 21, weight: 0 },
  atr: { enabled: true, length: 14, weight: 0 },
  obv: { ...off, length: 14, weight: 0 },
  so: {
    enabled: false,
    kPeriod: 14,
    dPeriod: 3,
    smoothing: 3,
    tresholds: { overbought: 80, oversold: 20 },
    weight: 0,
  },
  srsi: {
    enabled: false,
    rsiLength: 14,
    stochLength: 14,
    kPeriod: 3,
    dPeriod: 3,
    smoothK: 3,
    smoothD: 3,
    history: 3,
    tresholds: { overbought: 80, oversold: 20 },
    weight: 0,
  },
  dmi: { enabled: false, dmiLength: 14, adxSmoothing: 14, weight: 0 },
  OpenAI: { enabled: false, key: "", model: "", history: "", overwrite: false },
});

/** Mean-reversion: buy extremes / sell extremes — no late momentum chase. */
export function meanReversionAlgorithmicIndicators(): IndicatorBlock {
  return {
    ...baseOffBlocks(),
    macd: { enabled: false, fast: 12, slow: 26, signal: 9, weight: 0 },
    rsi: {
      enabled: true,
      length: 14,
      smoothing: { type: "EMA", length: 14 },
      history: 3,
      tresholds: { overbought: 70, oversold: 30 },
      weight: 1.2,
    },
    adx: { enabled: false, dilength: 14, adxSmoothing: 14, weight: 0 },
    cmf: {
      enabled: true,
      length: 20,
      history: 3,
      tresholds: { overbought: 0.1, oversold: -0.1 },
      weight: 0.9,
    },
    bb: {
      enabled: true,
      length: 20,
      multiplier: 2,
      average: "SMA",
      history: 3,
      weight: 1.2,
    },
  };
}

/** Volatile mean-reversion: wider bands so noise does not flip votes constantly. */
export function meanReversionVolatileAlgorithmicIndicators(): IndicatorBlock {
  return {
    ...baseOffBlocks(),
    macd: { enabled: false, fast: 12, slow: 26, signal: 9, weight: 0 },
    rsi: {
      enabled: true,
      length: 14,
      smoothing: { type: "EMA", length: 14 },
      history: 3,
      tresholds: { overbought: 75, oversold: 25 },
      weight: 1.2,
    },
    adx: { enabled: false, dilength: 14, adxSmoothing: 14, weight: 0 },
    cmf: {
      enabled: true,
      length: 20,
      history: 3,
      tresholds: { overbought: 0.15, oversold: -0.15 },
      weight: 0.9,
    },
    bb: {
      enabled: true,
      length: 20,
      multiplier: 2.2,
      average: "SMA",
      history: 3,
      weight: 1.2,
    },
  };
}

/** Momentum: follow strength — no RSI/BB mean-reversion votes. */
export function momentumAlgorithmicIndicators(): IndicatorBlock {
  return {
    ...baseOffBlocks(),
    macd: { enabled: true, fast: 12, slow: 26, signal: 9, weight: 1.4 },
    rsi: {
      enabled: false,
      length: 14,
      smoothing: { type: "EMA", length: 14 },
      history: 3,
      tresholds: { overbought: 70, oversold: 30 },
      weight: 0,
    },
    adx: { enabled: true, dilength: 14, adxSmoothing: 14, weight: 1.2 },
    cmf: {
      enabled: true,
      length: 20,
      history: 3,
      tresholds: { overbought: 0.1, oversold: -0.1 },
      weight: 0.9,
    },
    bb: {
      enabled: false,
      length: 20,
      multiplier: 2,
      average: "SMA",
      history: 3,
      weight: 0,
    },
  };
}

/** Legacy mixed set — kept for backward compatibility; prefer meanReversion or momentum. */
export function recommendedAlgorithmicIndicators(): IndicatorBlock {
  return {
    ...baseOffBlocks(),
    macd: { enabled: true, fast: 12, slow: 26, signal: 9, weight: 1.2 },
    rsi: {
      enabled: true,
      length: 14,
      smoothing: { type: "EMA", length: 14 },
      history: 3,
      tresholds: { overbought: 70, oversold: 30 },
      weight: 1,
    },
    adx: { enabled: true, dilength: 14, adxSmoothing: 14, weight: 1 },
    cmf: {
      enabled: true,
      length: 20,
      history: 3,
      tresholds: { overbought: 0.1, oversold: -0.1 },
      weight: 0.9,
    },
    bb: {
      enabled: true,
      length: 20,
      multiplier: 2,
      average: "SMA",
      history: 3,
      weight: 1,
    },
  };
}

const PRESET_KEYS: (keyof IndicatorBlock)[] = [
  "sma",
  "renko",
  "ema",
  "macd",
  "rsi",
  "adx",
  "atr",
  "obv",
  "cmf",
  "bb",
  "so",
  "srsi",
  "dmi",
  "OpenAI",
];

export const resolveIndicatorsPreset = (sym: SymbolOptions): IndicatorsPreset => {
  const p = sym.indicatorsPreset;
  if (
    p === "custom" ||
    p === "meanReversion" ||
    p === "meanReversionVolatile" ||
    p === "momentum" ||
    p === "complementary"
  ) {
    return p;
  }
  return "meanReversion";
};

export const indicatorsForPreset = (preset: IndicatorsPreset): IndicatorBlock => {
  if (preset === "momentum") return momentumAlgorithmicIndicators();
  if (preset === "complementary") return recommendedAlgorithmicIndicators();
  if (preset === "meanReversionVolatile") return meanReversionVolatileAlgorithmicIndicators();
  return meanReversionAlgorithmicIndicators();
};

export const scoutIndicatorsForPreset = (preset: IndicatorsPreset): Array<"rsi" | "bb" | "macd"> => {
  if (preset === "momentum") return ["macd"];
  return ["rsi", "bb"];
};

const mergePresetOntoSymbol = (sym: SymbolOptions, rec: IndicatorBlock, preset: IndicatorsPreset): void => {
  if (!sym.indicators) {
    sym.indicators = rec;
  } else {
    const cur = sym.indicators;
    for (const key of PRESET_KEYS) {
      const presetBlock = rec[key];
      if (!presetBlock) continue;
      const existing = cur[key];
      cur[key] = {
        ...(presetBlock as object),
        ...(existing && typeof existing === "object" ? (existing as object) : {}),
        enabled: presetBlock.enabled,
        weight: "weight" in presetBlock ? presetBlock.weight : (existing as { weight?: number })?.weight,
      } as never;
    }
  }
  sym.indicatorsPreset = preset;
  if (sym.scoutConfirm) {
    sym.scoutConfirm = {
      ...sym.scoutConfirm,
      scoutIndicators: scoutIndicatorsForPreset(preset),
    };
  } else if (preset !== "complementary") {
    sym.scoutConfirm = {
      enabled: true,
      scoutTimeframe: "3m",
      confirmTimeframe: "5m",
      scoutMinShare: 55,
      scoutIndicators: scoutIndicatorsForPreset(preset),
    };
  }
};

/** Apply chosen paradigm (or default meanReversion). */
export function applyRecommendedAlgorithmicIndicators(sym: SymbolOptions): void {
  const preset = resolveIndicatorsPreset(sym);
  if (preset === "custom") return;
  mergePresetOntoSymbol(sym, indicatorsForPreset(preset), preset);
}

export function applyIndicatorParadigm(sym: SymbolOptions, preset: Exclude<IndicatorsPreset, "custom">): void {
  mergePresetOntoSymbol(sym, indicatorsForPreset(preset), preset);
}

/** True when load should overwrite enabled/weight from a named paradigm. */
export function shouldApplyComplementaryIndicators(sym: SymbolOptions): boolean {
  return resolveIndicatorsPreset(sym) !== "custom";
}

export function shouldApplyIndicatorParadigm(sym: SymbolOptions): boolean {
  return shouldApplyComplementaryIndicators(sym);
}
