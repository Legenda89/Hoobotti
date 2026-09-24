/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/**
 * Scout (1m, kevyt RSI+BB sulkeutuneella kynttilällä) + Confirm (3m/5m, täysi äänestys).
 * Entry vain kun scout lukitsee suunnan balance-puolen `next`-mukaan ja confirm täyttää agreementin.
 */

import type { Candlestick, Candlesticks } from "../Exchanges/Candlesticks";
import { checkADXSignals } from "../Indicators/ADX";
import { checkBollingerBandsSignals } from "../Indicators/BollingerBands";
import { checkCMFSignals } from "../Indicators/CMF";
import { checkDMISignals } from "../Indicators/DMI";
import { checkEMASignals } from "../Indicators/EMA";
import { checkMACDSignals } from "../Indicators/MACD";
import { checkOBVSignals } from "../Indicators/OBV";
import { checkRenkoSignals } from "../Indicators/Renko";
import { checkRSISignals } from "../Indicators/RSI";
import { checkSMASignals } from "../Indicators/SMA";
import {
  checkStochasticOscillatorSignals,
  checkStochasticRSISignals,
} from "../Indicators/StochasticOscillator";
import type { ConsoleLogger } from "../Utilities/ConsoleLogger";
import type { CandlestickInterval, ExchangeOptions, SymbolOptions } from "../Utilities/Args";
import { toSymbolKey } from "../Utilities/Args";
import type { Indicators } from "./Algorithmic";
import {
  type AlgorithmicAdaptiveConfig,
  type DirectionsVote,
  isProfitDirectionOverride,
  resolveEffectiveAgreement,
} from "./algorithmicAdaptive";

export type ScoutConfirmIndicatorKey = "rsi" | "bb" | "macd";

export type ScoutConfirmConfig = {
  enabled: boolean;
  scoutTimeframe: CandlestickInterval;
  confirmTimeframe: CandlestickInterval;
  scoutMinShare: number;
  /** Jos asetettu, korvaa symbol.agreement confirm-kerroksessa. */
  confirmAgreement?: number;
  scoutIndicators: ScoutConfirmIndicatorKey[];
};

type ScoutRuntime = {
  lockedScoutStart?: number;
  lockedScoutVote: "BUY" | "SELL" | "HOLD";
};

type Directions = DirectionsVote;

type Checks = Record<string, string>;

type Weights = Record<string, number>;

const SCOUT_INDICATOR_TO_CHECK: Record<ScoutConfirmIndicatorKey, string> = {
  rsi: "RSI",
  bb: "BollingerBands",
  macd: "MACD",
};

const runtimeBySymbol = new Map<string, ScoutRuntime>();

export const resetScoutConfirmRuntime = (symbolKey?: string): void => {
  if (symbolKey) {
    runtimeBySymbol.delete(symbolKey);
    return;
  }
  runtimeBySymbol.clear();
};

const defaultScoutIndicators = (): ScoutConfirmIndicatorKey[] => ["rsi", "bb"];

export const resolveScoutConfirmConfig = (symbolOptions: SymbolOptions): ScoutConfirmConfig => {
  const raw = symbolOptions.scoutConfirm;
  const enabled = raw?.enabled === true;
  const scoutMin = Number(raw?.scoutMinShare);
  const confirmAgreementRaw = raw?.confirmAgreement;
  const confirmAgreement =
    confirmAgreementRaw != null && Number.isFinite(Number(confirmAgreementRaw))
      ? Number(confirmAgreementRaw)
      : undefined;
  const scoutIndicators =
    Array.isArray(raw?.scoutIndicators) && raw!.scoutIndicators.length > 0
      ? raw!.scoutIndicators.filter(
          (k): k is ScoutConfirmIndicatorKey => k === "rsi" || k === "bb" || k === "macd"
        )
      : defaultScoutIndicators();
  return {
    enabled,
    scoutTimeframe: (raw?.scoutTimeframe ?? "1m") as CandlestickInterval,
    confirmTimeframe: (raw?.confirmTimeframe ?? "3m") as CandlestickInterval,
    scoutMinShare: Number.isFinite(scoutMin) && scoutMin > 0 ? scoutMin : 40,
    confirmAgreement,
    scoutIndicators: scoutIndicators.length > 0 ? scoutIndicators : defaultScoutIndicators(),
  };
};

/** Varmista että molemmat TF:t ovat tilauksessa ja confirm on ensimmäisenä (profit/primary). */
export const normalizeScoutConfirmTimeframes = (sym: SymbolOptions): void => {
  const cfg = resolveScoutConfirmConfig(sym);
  if (!cfg.enabled) return;
  const set = new Set(sym.timeframes ?? []);
  set.add(cfg.scoutTimeframe);
  set.add(cfg.confirmTimeframe);
  const rest = [...set].filter((tf) => tf !== cfg.confirmTimeframe && tf !== cfg.scoutTimeframe);
  sym.timeframes = [cfg.confirmTimeframe, cfg.scoutTimeframe, ...rest];
};

/** Viimeisin täysin sulkeutunut kynttilä (ei muodostuvaa palkkia). */
export const getLastCompletedCandle = (series: Candlestick[] | undefined): Candlestick | undefined => {
  if (!series?.length) return undefined;
  const last = series[series.length - 1]!;
  if (last.isFinal === true) return last;
  if (series.length >= 2) return series[series.length - 2];
  return undefined;
};

const candleStartTime = (c: Candlestick): number => c.startTime ?? c.time;

/** Indikaattorit vain sulkeutuneeseen scout-palkkiin asti. */
export const seriesThroughClosedBar = (series: Candlestick[] | undefined): Candlestick[] | undefined => {
  if (!series?.length) return series;
  const closed = getLastCompletedCandle(series);
  if (!closed) {
    return series.length >= 2 ? series.slice(0, -1) : series;
  }
  const target = candleStartTime(closed);
  for (let i = series.length - 1; i >= 0; i--) {
    if (candleStartTime(series[i]!) === target) {
      return series.slice(0, i + 1);
    }
  }
  return series.slice(0, -1);
};

const sliceTupleSeries = <T>(arr: T[] | undefined, len: number): T[] | undefined =>
  arr?.length ? arr.slice(0, Math.min(len, arr.length)) : arr;

const sliceBollinger = (
  bb: [number[], number[], number[]] | undefined,
  len: number
): [number[], number[], number[]] | undefined => {
  if (!bb) return bb;
  return [sliceTupleSeries(bb[0], len) ?? [], sliceTupleSeries(bb[1], len) ?? [], sliceTupleSeries(bb[2], len) ?? []];
};

const indicatorWeights = (symbolOptions: SymbolOptions): Weights => ({
  SMAWeight: symbolOptions.indicators?.sma?.weight ?? 0,
  EMAWeight: symbolOptions.indicators?.ema?.weight ?? 0,
  ADXWeight: symbolOptions.indicators?.adx?.weight ?? 0,
  MACDWeight: symbolOptions.indicators?.macd?.weight ?? 0,
  RSIWeight: symbolOptions.indicators?.rsi?.weight ?? 0,
  StochasticOscillatorWeight: symbolOptions.indicators?.so?.weight ?? 0,
  StochasticRSIWeight: symbolOptions.indicators?.srsi?.weight ?? 0,
  BollingerBandsWeight: symbolOptions.indicators?.bb?.weight ?? 0,
  OBVWeight: symbolOptions.indicators?.obv?.weight ?? 0,
  CMFWeight: symbolOptions.indicators?.cmf?.weight ?? 0,
  RenkoWeight: symbolOptions.indicators?.renko?.weight ?? 0,
  DMIWeight: symbolOptions.indicators?.dmi?.weight ?? 0,
});

export const buildIndicatorChecksForTimeframe = (
  timeframe: string,
  symbol: string,
  candlesticks: Candlesticks,
  indicators: Indicators,
  symbolOptions: SymbolOptions,
  allowedCheckKeys?: Set<string>,
  throughClosedBar?: boolean
): Checks => {
  const symbolKey = toSymbolKey(symbol);
  const rawSeries = candlesticks[symbolKey]?.[timeframe];
  const seriesForBb = throughClosedBar ? seriesThroughClosedBar(rawSeries) ?? rawSeries : rawSeries;
  const closedLen = seriesForBb?.length ?? rawSeries?.length ?? 0;
  const rsiSeries = sliceTupleSeries(indicators.rsi[timeframe], closedLen);
  const bbSeries = throughClosedBar
    ? sliceBollinger(indicators.bollingerBands[timeframe], closedLen)
    : indicators.bollingerBands[timeframe];
  const checks: Checks = {
    SMA: checkSMASignals(indicators.sma[timeframe], symbolOptions),
    Renko: checkRenkoSignals(indicators.renko[timeframe], symbolOptions),
    EMA: checkEMASignals(indicators.ema[timeframe], symbolOptions),
    ADX: checkADXSignals(indicators.adx[timeframe], symbolOptions),
    MACD: checkMACDSignals(indicators.macd[timeframe], symbolOptions),
    RSI: checkRSISignals(rsiSeries, symbolOptions),
    StochasticOscillator: checkStochasticOscillatorSignals(
      indicators.stochasticOscillator[timeframe],
      symbolOptions
    ),
    StochasticRSI: checkStochasticRSISignals(indicators.stochasticRSI[timeframe], symbolOptions),
    BollingerBands: checkBollingerBandsSignals(
      seriesForBb,
      bbSeries ?? indicators.bollingerBands[timeframe],
      symbolOptions
    ),
    OBV: checkOBVSignals(seriesForBb, indicators.obv[timeframe], symbolOptions),
    CMF: checkCMFSignals(indicators.cmf[timeframe], symbolOptions),
    DMI: checkDMISignals(indicators.dmi[timeframe], symbolOptions),
  };
  if (!allowedCheckKeys) return checks;
  const filtered: Checks = {};
  for (const key of allowedCheckKeys) {
    if (checks[key] !== undefined) filtered[key] = checks[key]!;
    else filtered[key] = "SKIP";
  }
  return filtered;
};

export const computeWeightedDirections = (
  checks: Checks,
  symbolOptions: SymbolOptions,
  timeframeDivisor: number
): Directions => {
  const directions: Directions = { BUY: 0, SELL: 0, HOLD: 0 };
  const actions = ["BUY", "SELL", "HOLD"] as const;
  const keys = Object.keys(checks).filter((check) => checks[check] !== "SKIP");
  const weights = indicatorWeights(symbolOptions);
  const divisor = timeframeDivisor > 0 ? timeframeDivisor : 1;

  for (const action of actions) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const key of keys) {
      const weight = weights[`${key}Weight`] ?? 0;
      const signal = checks[key];
      if (signal === action) {
        weightedSum += weight;
      } else if (signal === "BOTH" && (action === "SELL" || action === "BUY")) {
        weightedSum += weight;
      }
      totalWeight += weight;
    }
    if (totalWeight > 0) {
      directions[action] += ((weightedSum / totalWeight) * 100) / divisor;
    }
  }
  return directions;
};

const scoutAllowedKeys = (cfg: ScoutConfirmConfig): Set<string> =>
  new Set(cfg.scoutIndicators.map((k) => SCOUT_INDICATOR_TO_CHECK[k]));

const getRuntime = (symbolKey: string): ScoutRuntime => {
  let rt = runtimeBySymbol.get(symbolKey);
  if (!rt) {
    rt = { lockedScoutVote: "HOLD" };
    runtimeBySymbol.set(symbolKey, rt);
  }
  return rt;
};

const lockScoutVote = (
  symbolKey: string,
  closedStart: number,
  directions: Directions,
  next: string,
  scoutMinShare: number
): "BUY" | "SELL" | "HOLD" => {
  const rt = getRuntime(symbolKey);
  if (rt.lockedScoutStart === closedStart) return rt.lockedScoutVote;

  const vote =
    (directions[next] ?? 0) >= scoutMinShare && (next === "BUY" || next === "SELL")
      ? (next as "BUY" | "SELL")
      : "HOLD";
  rt.lockedScoutStart = closedStart;
  rt.lockedScoutVote = vote;
  return vote;
};

export type ScoutConfirmEntryResult = {
  direction: string;
  scoutVote: "BUY" | "SELL" | "HOLD";
  confirmDirections: DirectionsVote;
  scoutDirections: DirectionsVote;
  scoutClosedStart?: number;
  debug: Record<string, unknown>;
};

export const resolveScoutConfirmEntryDirection = (opts: {
  consoleLogger: ConsoleLogger;
  symbol: string;
  symbolKey: string;
  candlesticks: Candlesticks;
  indicators: Indicators;
  symbolOptions: SymbolOptions;
  exchangeOptions: ExchangeOptions;
  scoutCfg: ScoutConfirmConfig;
  next: string;
  trend: string;
  volMult: number;
  adaptiveCfg: AlgorithmicAdaptiveConfig & { enabled: boolean };
  closeTime: number;
  profit: string;
}): ScoutConfirmEntryResult => {
  const {
    symbol,
    symbolKey,
    candlesticks,
    indicators,
    symbolOptions,
    exchangeOptions,
    scoutCfg,
    next,
    trend,
    volMult,
    adaptiveCfg,
    closeTime,
    profit,
  } = opts;

  const profitOverride = isProfitDirectionOverride(profit);
  const scoutSeries = candlesticks[symbolKey]?.[scoutCfg.scoutTimeframe];
  const closed = getLastCompletedCandle(scoutSeries);

  const scoutChecks = buildIndicatorChecksForTimeframe(
    scoutCfg.scoutTimeframe,
    symbol,
    candlesticks,
    indicators,
    symbolOptions,
    scoutAllowedKeys(scoutCfg),
    true
  );
  const scoutDirections = computeWeightedDirections(scoutChecks, symbolOptions, 1);

  let scoutVote: "BUY" | "SELL" | "HOLD" = "HOLD";
  let scoutClosedStart: number | undefined;

  if (closed) {
    scoutClosedStart = candleStartTime(closed);
    scoutVote = lockScoutVote(symbolKey, scoutClosedStart, scoutDirections, next, scoutCfg.scoutMinShare);
  } else {
    scoutVote = getRuntime(symbolKey).lockedScoutVote;
  }

  const confirmChecks = buildIndicatorChecksForTimeframe(
    scoutCfg.confirmTimeframe,
    symbol,
    candlesticks,
    indicators,
    symbolOptions,
    undefined,
    true
  );
  const confirmDirections = computeWeightedDirections(confirmChecks, symbolOptions, 1);

  const baseAgreement = scoutCfg.confirmAgreement ?? symbolOptions.agreement;
  const agreementMeta = resolveEffectiveAgreement({
    baseAgreement,
    volMult,
    cfg: adaptiveCfg,
    next,
    trend,
    directions: confirmDirections,
    closeTime,
    symbolOptions,
    exchangeOptions,
  });

  let direction = "HOLD";
  if (profitOverride) {
    direction = next;
  } else if (scoutVote !== next) {
    direction = "HOLD";
  } else if (agreementMeta.conflict) {
    direction = "HOLD";
  } else if ((confirmDirections[next] ?? 0) >= agreementMeta.effective) {
    direction = next;
  }

  const debug = {
    scoutTimeframe: scoutCfg.scoutTimeframe,
    confirmTimeframe: scoutCfg.confirmTimeframe,
    scoutClosedStart,
    scoutVote,
    scoutDirections,
    confirmDirections,
    agreement: agreementMeta,
    profitOverride,
    next,
  };

  return {
    direction,
    scoutVote,
    scoutDirections,
    confirmDirections,
    scoutClosedStart,
    debug,
  };
};
