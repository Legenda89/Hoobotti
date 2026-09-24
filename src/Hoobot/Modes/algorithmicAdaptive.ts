/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/**
 * Algorithmic-adaptive: ATR/vol-skaalaus, trendi-agreement, konfliktisuodatus, idle-ease.
 * Oletus päällä (enabled !== false). Pois: algorithmicAdaptive.enabled = false.
 */

import type { Candlestick } from "../Exchanges/Candlesticks";
import type { ExchangeOptions, SymbolOptions } from "../Utilities/Args";
import { getSecondsFromInterval, toSymbolKey } from "../Utilities/Args";
import { volatilityMultiplierFromSeries } from "./Extreme";

export type AlgorithmicAdaptiveConfig = {
  enabled?: boolean;
  /** ATR% vs mediaani → TP/profit-min skaalaus. */
  volatilityScale?: boolean;
  atrLookback?: number;
  /** Korkeampi vol → korkeampi agreement-kynnys. */
  volatilityAgreement?: boolean;
  /** Trendin suunta vs next → helpota/tiukenna agreement. */
  trendAgreement?: boolean;
  trendAlignedBonus?: number;
  trendCounterPenalty?: number;
  /**
   * Estä algorithmic entry (BUY/SELL/SKIP) kun 4h-trend on vastakkainen.
   * Oletus: true kun adaptive enabled. TP/SL-sulkuja ei estetä.
   */
  blockCounterTrendEntries?: boolean;
  /** BUY+SELL äänet molemmat korkeat → HOLD (ellei TP/SL). */
  conflictEnabled?: boolean;
  conflictMinShare?: number;
  conflictPenalty?: number;
  /** Kynttilöitä käteisessä/longina ilman kauppaa → laske agreement-kynnystä. */
  maxCashCandles?: number;
  maxLongCandles?: number;
  agreementEaseMax?: number;
  /** profit.minimum* ≥ 2× fee + puskuri. */
  feeAwareMinProfit?: boolean;
};

export type DirectionsVote = {
  [key: string]: number;
};

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));

export const defaultAlgorithmicAdaptiveConfig = (): Required<
  Pick<
    AlgorithmicAdaptiveConfig,
    | "volatilityScale"
    | "atrLookback"
    | "volatilityAgreement"
    | "trendAgreement"
    | "trendAlignedBonus"
    | "trendCounterPenalty"
    | "blockCounterTrendEntries"
    | "conflictEnabled"
    | "conflictMinShare"
    | "conflictPenalty"
    | "maxCashCandles"
    | "maxLongCandles"
    | "agreementEaseMax"
    | "feeAwareMinProfit"
  >
> => ({
  volatilityScale: true,
  atrLookback: 48,
  volatilityAgreement: true,
  trendAgreement: true,
  trendAlignedBonus: 6,
  trendCounterPenalty: 10,
  blockCounterTrendEntries: true,
  conflictEnabled: true,
  conflictMinShare: 38,
  conflictPenalty: 12,
  maxCashCandles: 288,
  maxLongCandles: 192,
  agreementEaseMax: 15,
  feeAwareMinProfit: true,
});

export const resolveAlgorithmicAdaptiveConfig = (symbolOptions: SymbolOptions): AlgorithmicAdaptiveConfig & {
  enabled: boolean;
} => {
  const raw = symbolOptions.algorithmicAdaptive;
  const def = defaultAlgorithmicAdaptiveConfig();
  if (raw?.enabled === false) {
    return { enabled: false };
  }
  const lookback = Number(raw?.atrLookback);
  const maxCash = Number(raw?.maxCashCandles);
  const maxLong = Number(raw?.maxLongCandles);
  const easeMax = Number(raw?.agreementEaseMax);
  const conflictMin = Number(raw?.conflictMinShare);
  const aligned = Number(raw?.trendAlignedBonus);
  const counter = Number(raw?.trendCounterPenalty);
  const conflictPen = Number(raw?.conflictPenalty);
  return {
    enabled: true,
    volatilityScale: raw?.volatilityScale !== false,
    atrLookback: Number.isFinite(lookback) && lookback >= 8 ? Math.floor(lookback) : def.atrLookback,
    volatilityAgreement: raw?.volatilityAgreement !== false,
    trendAgreement: raw?.trendAgreement !== false,
    trendAlignedBonus: Number.isFinite(aligned) ? aligned : def.trendAlignedBonus,
    trendCounterPenalty: Number.isFinite(counter) ? counter : def.trendCounterPenalty,
    blockCounterTrendEntries: raw?.blockCounterTrendEntries !== false,
    conflictEnabled: raw?.conflictEnabled !== false,
    conflictMinShare: Number.isFinite(conflictMin) && conflictMin > 0 ? conflictMin : def.conflictMinShare,
    conflictPenalty: Number.isFinite(conflictPen) && conflictPen >= 0 ? conflictPen : def.conflictPenalty,
    maxCashCandles: Number.isFinite(maxCash) && maxCash > 0 ? Math.floor(maxCash) : def.maxCashCandles,
    maxLongCandles: Number.isFinite(maxLong) && maxLong > 0 ? Math.floor(maxLong) : def.maxLongCandles,
    agreementEaseMax: Number.isFinite(easeMax) && easeMax >= 0 ? easeMax : def.agreementEaseMax,
    feeAwareMinProfit: raw?.feeAwareMinProfit !== false,
  };
};

/** ATR/close vs mediaani → 0.75–1.35. */
export const atrVolatilityMultiplier = (
  atrSeries: number[] | undefined,
  closePrice: number,
  lookback: number
): number => {
  if (!atrSeries?.length || !(closePrice > 0)) return 1;
  const tail = atrSeries.slice(-Math.min(lookback, atrSeries.length));
  const ratios = tail.filter((a) => Number.isFinite(a) && a > 0).map((a) => a / closePrice);
  if (ratios.length < 3) return 1;
  const cur = ratios[ratios.length - 1]!;
  const sorted = [...ratios].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const raw = med > 0 ? cur / med : 1;
  return clamp(0.75, 1.35, raw);
};

export const resolveVolatilityMultiplier = (
  series: Candlestick[],
  atrSeries: number[] | undefined,
  closePrice: number,
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean }
): number => {
  if (!cfg.enabled || cfg.volatilityScale === false) return 1;
  const lookback = cfg.atrLookback ?? 48;
  const fromAtr = atrVolatilityMultiplier(atrSeries, closePrice, lookback);
  if (fromAtr !== 1) return fromAtr;
  return volatilityMultiplierFromSeries(series, lookback);
};

export const roundTripFeePct = (tradeFeePercentage?: number): number => (tradeFeePercentage ?? 0.075) * 2;

/** Kopio symbolOptions + skaalatut profit/TP minimit (ei mutatoi alkuperäistä). */
export const withAdaptiveProfitScaling = (
  symbolOptions: SymbolOptions,
  volMult: number,
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean }
): SymbolOptions => {
  if (!cfg.enabled || volMult === 1 && cfg.feeAwareMinProfit === false) {
    return symbolOptions;
  }
  const floor = cfg.feeAwareMinProfit !== false ? roundTripFeePct(symbolOptions.tradeFeePercentage) + 0.05 : 0;
  const scale = (v: number) => {
    const n = Number.isFinite(v) ? v : 0;
    if (n <= 0) return floor > 0 ? floor : n;
    return Math.max(floor, n * volMult);
  };

  const profit = symbolOptions.profit ? { ...symbolOptions.profit } : undefined;
  if (profit) {
    if (profit.minimumSell) profit.minimumSell = scale(profit.minimumSell);
    if (profit.minimumBuy) profit.minimumBuy = scale(profit.minimumBuy);
  }

  const takeProfit = symbolOptions.takeProfit ? { ...symbolOptions.takeProfit } : undefined;
  if (takeProfit) {
    if (takeProfit.minimum) takeProfit.minimum = scale(takeProfit.minimum);
    if (takeProfit.drop) takeProfit.drop = scale(takeProfit.drop);
    if (takeProfit.limit) takeProfit.limit = scale(takeProfit.limit);
    if (takeProfit.forceMinProfit != null) {
      takeProfit.forceMinProfit = scale(takeProfit.forceMinProfit);
    }
  }

  const takeProfitBuy = symbolOptions.takeProfitBuy ? { ...symbolOptions.takeProfitBuy } : undefined;
  if (takeProfitBuy) {
    if (takeProfitBuy.minimum) takeProfitBuy.minimum = scale(takeProfitBuy.minimum);
    if (takeProfitBuy.drop) takeProfitBuy.drop = scale(takeProfitBuy.drop);
    if (takeProfitBuy.limit) takeProfitBuy.limit = scale(takeProfitBuy.limit);
    if (takeProfitBuy.forceMinProfit != null) {
      takeProfitBuy.forceMinProfit = scale(takeProfitBuy.forceMinProfit);
    }
  }

  return {
    ...symbolOptions,
    ...(profit ? { profit } : {}),
    ...(takeProfit ? { takeProfit } : {}),
    ...(takeProfitBuy ? { takeProfitBuy } : {}),
  };
};

export const agreementVolatilityDelta = (volMult: number): number => {
  if (volMult <= 1) return 0;
  return Math.round((volMult - 1) * 24);
};

/** TP/SL/time-stop — ohittaa scout/agreement; sulku menee läpi. */
export const isProfitDirectionOverride = (profit: string): boolean =>
  profit === "TAKE_PROFIT" ||
  profit === "TAKE_PROFIT_FORCE" ||
  profit === "STOP_LOSS" ||
  profit === "STALE_EXIT";

export const trendAgreementDelta = (
  next: string,
  trend: string,
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean }
): number => {
  if (!cfg.enabled || cfg.trendAgreement === false) return 0;
  const bonus = cfg.trendAlignedBonus ?? 6;
  const penalty = cfg.trendCounterPenalty ?? 10;
  if (next === "BUY") {
    if (trend === "LONG") return -bonus;
    if (trend === "SHORT") return penalty;
  } else if (next === "SELL") {
    if (trend === "SHORT") return -bonus;
    if (trend === "LONG") return penalty;
  }
  return 0;
};

/**
 * Hard-block algorithmic *entries* against the higher-TF trend.
 * Only when profit === "SKIP" (uusi positio). Ei estä profit=BUY/SELL -uloskäyntejä
 * eikä STOP_LOSS / TAKE_PROFIT(_FORCE).
 */
export const shouldBlockCounterTrendEntry = (
  direction: string,
  profit: string,
  trend: string,
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean }
): boolean => {
  if (!cfg.enabled || cfg.blockCounterTrendEntries === false) return false;
  if (isProfitDirectionOverride(profit)) return false;
  // Vain puhtaat entryt — mean-reversion tarvitsee SELL/BUY-uloskäynnit myös vastatrendiin.
  if (profit !== "SKIP") return false;
  if (direction === "BUY" && trend === "SHORT") return true;
  if (direction === "SELL" && trend === "LONG") return true;
  return false;
};

export const detectVoteConflict = (directions: DirectionsVote, minSharePct: number): boolean => {
  const buy = directions.BUY ?? 0;
  const sell = directions.SELL ?? 0;
  return buy >= minSharePct && sell >= minSharePct;
};

export const candlesSinceLastTrade = (
  symbolOptions: SymbolOptions,
  closeTime: number,
  exchangeOptions: ExchangeOptions
): number => {
  const symbolKey = toSymbolKey(symbolOptions.name);
  const th = exchangeOptions.tradeHistory?.[symbolKey];
  const primaryInterval = symbolOptions.timeframes?.[0];
  if (!primaryInterval) return 0;
  const intervalSeconds = getSecondsFromInterval(primaryInterval);
  if (intervalSeconds <= 0) return 0;

  let refTime: number | undefined;
  if (th?.length) {
    refTime = th[th.length - 1]?.time;
  } else {
    // Ensimmäinen entry: ilman tätä ease ei koskaan käynnisty (odotti aina 0).
    const sessionStart = Number(exchangeOptions.simulationSessionStartMs);
    if (Number.isFinite(sessionStart) && sessionStart > 0) {
      refTime = sessionStart;
    } else {
      return 0;
    }
  }
  if (refTime == null || !Number.isFinite(refTime)) return 0;
  const elapsedSeconds = (closeTime - refTime) / 1000;
  return Math.max(0, Math.floor(elapsedSeconds / intervalSeconds));
};

/** Negatiivinen arvo laskee vaadittua agreement-% (helpottaa jumitusta). */
export const agreementEaseFromWait = (
  waited: number,
  next: string,
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean }
): number => {
  if (!cfg.enabled || waited <= 0) return 0;
  const escapeAt = next === "BUY" ? (cfg.maxCashCandles ?? 288) : (cfg.maxLongCandles ?? 192);
  if (waited < escapeAt) return 0;
  const idleEnd = escapeAt + Math.max(Math.floor(escapeAt * 0.5), 96);
  const span = Math.max(1, idleEnd - escapeAt);
  const progress = Math.min(1, (waited - escapeAt) / span);
  const easeMax = cfg.agreementEaseMax ?? 15;
  return -Math.round(easeMax * progress);
};

export const resolveEffectiveAgreement = (opts: {
  baseAgreement: number;
  volMult: number;
  cfg: AlgorithmicAdaptiveConfig & { enabled: boolean };
  next: string;
  trend: string;
  directions: DirectionsVote;
  closeTime: number;
  symbolOptions: SymbolOptions;
  exchangeOptions: ExchangeOptions;
}): { effective: number; conflict: boolean; volMult: number; ease: number; trendDelta: number; volDelta: number } => {
  const { cfg, directions, next, trend, baseAgreement, volMult } = opts;
  if (!cfg.enabled) {
    return {
      effective: baseAgreement,
      conflict: false,
      volMult,
      ease: 0,
      trendDelta: 0,
      volDelta: 0,
    };
  }
  let effective = baseAgreement;
  const volDelta = cfg.volatilityAgreement !== false ? agreementVolatilityDelta(volMult) : 0;
  const trendDelta = trendAgreementDelta(next, trend, cfg);
  const waited = candlesSinceLastTrade(opts.symbolOptions, opts.closeTime, opts.exchangeOptions);
  const ease = agreementEaseFromWait(waited, next, cfg);
  const conflict = cfg.conflictEnabled !== false && detectVoteConflict(directions, cfg.conflictMinShare ?? 38);
  if (conflict) {
    effective += cfg.conflictPenalty ?? 12;
  }
  effective += volDelta + trendDelta + ease;
  effective = clamp(50, 98, effective);
  return { effective, conflict, volMult, ease, trendDelta, volDelta };
};
