/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are not permitted without prior written permission
 * from Hoosat Oy. Unauthorized reproduction, copying, or use of this
 * software, in whole or in part, is strictly prohibited. All
 * modifications in source or binary must be submitted to Hoosat Oy in source format.
 *
 * THIS SOFTWARE IS PROVIDED BY HOOSAT OY "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL HOOSAT OY BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The user of this software uses it at their own risk. Hoosat Oy shall
 * not be liable for any losses, damages, or liabilities arising from
 * the use of this software.
 * ===================================================================== */

import { Orderbook } from "../Exchanges/Orderbook";
import { ExchangeOptions, SymbolOptions, getSecondsFromInterval, toSymbolKey } from "../Utilities/Args";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import {
  Trade,
  calculatePNLPercentageForLong,
  calculatePNLPercentageForShort,
  calculateUnrealizedPNLPercentageForLong,
  calculateUnrealizedPNLPercentageForShort,
  getPreviousTrades,
  readForceSkip,
} from "../Exchanges/Trades";
import { Candlestick } from "../Exchanges/Candlesticks";
import { resolveEffectiveProfitMinimums } from "../Trading/profitMinimums";
import { effectiveStopLossPnl, type StopLossAtrConfig } from "../Trading/stopLossAtr";
import { applyFeeAdjustmentToPnl } from "../Trading/tradeGates";
import { resolveOpenPositionEntryTrade } from "../Trading/positionState";
import { Filter } from "../Exchanges/Filters";
import {
  getTakeProfitRuntimeState,
  resetTakeProfitRuntimeForSymbol,
  resolveTakeProfitLeg,
  TakeProfitRuntimeState,
  updateTakeProfitRuntimeState,
} from "./takeProfitPositionState";

export { resetTakeProfitRuntimeForSymbol };

const sleep = async (ms: number) => await new Promise((r) => setTimeout(r, ms));

type TakeProfitConfig = {
  enabled?: boolean;
  limit?: number;
  minimum?: number;
  drop?: number;
  current?: number;
  currentMaxSource?: "update" | "trade" | "final";
  forceAfterEnabled?: boolean;
  forceAfterCandles?: number;
  forceAfterDrop?: number;
  forceMinProfit?: number;
};

/** Pakkosulku huipun pudotuksesta (forceAfter); vaatii forceAfterEnabled === true. */
export const applyTakeProfitForceAfter = (opts: {
  check: string;
  next: string;
  unrealizedPNL: number;
  peakUnrealizedPct: number;
  candlesSinceLastTrade: number;
  effectiveTrend: string;
  tpCfg?: TakeProfitConfig;
}): string => {
  if (opts.tpCfg?.enabled !== true || opts.tpCfg.forceAfterEnabled !== true) {
    return opts.check;
  }
  const forceAfterCandles = opts.tpCfg.forceAfterCandles;
  const forceAfterDrop = opts.tpCfg.forceAfterDrop;
  const forceMinProfit = opts.tpCfg.forceMinProfit;
  const dropFromPeak = opts.peakUnrealizedPct - opts.unrealizedPNL;
  const forceConditions =
    forceAfterCandles != null &&
    forceAfterDrop != null &&
    forceAfterCandles >= 0 &&
    forceAfterDrop >= 0 &&
    opts.candlesSinceLastTrade >= forceAfterCandles &&
    dropFromPeak >= forceAfterDrop &&
    opts.unrealizedPNL >= 0;
  const forceProfitAllowed =
    (forceMinProfit == null || opts.unrealizedPNL >= forceMinProfit) &&
    meetsTakeProfitLimitFloor(opts.unrealizedPNL, opts.tpCfg);
  if (!forceConditions || !forceProfitAllowed) {
    return opts.check;
  }
  let check = opts.check;
  if (check === "TAKE_PROFIT") {
    return "TAKE_PROFIT_FORCE";
  }
  if (check === "HOLD") {
    const trend = opts.effectiveTrend;
    const n = opts.next;
    if (trend === "LONG" && (n === "SELL" || n === "BOTH" || n === "BUY")) {
      return "TAKE_PROFIT_FORCE";
    }
    if (trend === "SHORT" && (n === "BUY" || n === "BOTH")) {
      return "TAKE_PROFIT_FORCE";
    }
    if (trend !== "LONG" && trend !== "SHORT" && (n === "SELL" || n === "BUY" || n === "BOTH")) {
      return "TAKE_PROFIT_FORCE";
    }
  }
  return check;
};

/**
 * BUY-polulla käytä takeProfitBuy vain kun takeProfitBuy.enabled === true.
 * Muuten aina pää-takeProfit (myynti-/sulkemispolku).
 */
const getTakeProfitConfigForNext = (symbolOptions: SymbolOptions, next: string): TakeProfitConfig | undefined => {
  const buyTp = symbolOptions.takeProfitBuy;
  if (next === "BUY" && buyTp !== undefined && buyTp.enabled === true) {
    return buyTp;
  }
  return symbolOptions.takeProfit;
};

/** BUY-polulla käytä stopLossBuy:ä vain jos täppä päällä (enabled === true); muuten sama stopLoss kuin myynnissä. */
const getStopLossConfigForNext = (symbolOptions: SymbolOptions, next: string) => {
  const buySl = symbolOptions.stopLossBuy;
  if (next === "BUY" && buySl !== undefined && buySl.enabled === true) {
    return buySl;
  }
  return symbolOptions.stopLoss;
};

/** takeProfit.limit > 0 → vähimmäis-unrealized % TP-suluille. 0 tai puuttuu = ei limit-lattiaa. */
export const takeProfitLimitFloorPct = (tpCfg?: TakeProfitConfig): number => {
  const lim = tpCfg?.limit;
  if (typeof lim === "number" && Number.isFinite(lim) && lim > 0) return lim;
  return 0;
};

const meetsTakeProfitLimitFloor = (unrealizedPNL: number, tpCfg?: TakeProfitConfig): boolean => {
  const floor = takeProfitLimitFloorPct(tpCfg);
  return floor <= 0 || unrealizedPNL >= floor;
};

/** Yksi trailing-sulku: armed (minimum) + pudotus huipusta (drop) + limit vain sulkurajana. */
export const evaluateTakeProfitTrailing = (
  unrealizedPNL: number,
  tpCfg: TakeProfitConfig | undefined,
  runtime: TakeProfitRuntimeState
): boolean => {
  const currentMaxPNL = runtime.peakUnrealizedPct;
  const cfgDrop = tpCfg?.drop ?? 0;
  const dropFromPeak = currentMaxPNL - unrealizedPNL;
  const shouldTrailing =
    runtime.armed &&
    cfgDrop > 0 &&
    unrealizedPNL > 0 &&
    unrealizedPNL < currentMaxPNL &&
    dropFromPeak >= cfgDrop;
  return shouldTrailing && meetsTakeProfitLimitFloor(unrealizedPNL, tpCfg);
};

/** Tarkistus ennen TP-toimeksiantoa (Trades.ts). */
export const meetsTakeProfitLimitForAction = (
  unrealizedPNL: number,
  symbolOptions: SymbolOptions,
  next: string
): boolean => {
  return meetsTakeProfitLimitFloor(unrealizedPNL, getTakeProfitConfigForNext(symbolOptions, next));
};

/** Päivitä huippu toimeksiannon yhteydessä kun currentMaxSource === "trade". */
export const recordTakeProfitPeakOnOrder = (
  symbolOptions: SymbolOptions,
  next: string,
  unrealizedPNL: number
): void => {
  const tpCfg = getTakeProfitConfigForNext(symbolOptions, next);
  if (!tpCfg || (tpCfg.currentMaxSource ?? "update") !== "trade") return;
  const symbolKey = toSymbolKey(symbolOptions.name);
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  updateTakeProfitRuntimeState({
    symbolKey,
    leg,
    unrealizedPNL,
    armMinimum: tpCfg.minimum ?? 0,
    allowPeakUpdate: true,
    tpCfg,
  });
};

/** Käynnistyksessä: synkkaa TP-runtime kaikille aktiivisille symboleille. */
export const seedTakeProfitRuntimeForAllSymbols = (options: {
  exchanges?: Array<{ symbols?: SymbolOptions[] }>;
}): void => {
  for (const ex of options.exchanges ?? []) {
    for (const sym of ex.symbols ?? []) {
      if (!sym || sym.enabled === false) continue;
      syncTakeProfitRuntimeFromConfig(sym);
    }
  }
};

/** Synkronoi runtime-Map configin current-arvosta (merge / käynnistys). */
export const syncTakeProfitRuntimeFromConfig = (symbolOptions: SymbolOptions): void => {
  const symbolKey = toSymbolKey(symbolOptions.name);
  resetTakeProfitRuntimeForSymbol(symbolKey);
  const seedLeg = (leg: "sell" | "buy", tpCfg?: TakeProfitConfig) => {
    if (!tpCfg) return;
    const peak = typeof tpCfg.current === "number" && Number.isFinite(tpCfg.current) ? tpCfg.current : 0;
    updateTakeProfitRuntimeState({
      symbolKey,
      leg,
      unrealizedPNL: peak,
      armMinimum: tpCfg.minimum ?? 0,
      allowPeakUpdate: false,
      tpCfg,
    });
  };
  seedLeg("sell", symbolOptions.takeProfit);
  if (symbolOptions.takeProfitBuy?.enabled === true) {
    seedLeg("buy", symbolOptions.takeProfitBuy);
  }
};

export type ProfitSignalContext = {
  atrPct?: number;
};

export const calculateProfitSignals = async (
  newTrend: string,
  next: string,
  lastTrade: Trade,
  _lastPNL: number,
  unrealizedPNL: number,
  closeTime: number,
  symbolOptions: SymbolOptions,
  ctx?: ProfitSignalContext
) => {
  let check = "HOLD";
  const tpCfg = getTakeProfitConfigForNext(symbolOptions, next);

  // Calculate time since the last trade (fractional hours — Math.ceil kiristi SL:ää heti 1. minuutilla)
  const timeSinceLastTrade = (closeTime - lastTrade.time) / (1000 * 60 * 60); // Time in hours
  const hoursSinceLastTrade = Math.max(0, timeSinceLastTrade);

  const symbolKey = toSymbolKey(symbolOptions.name);
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  const runtime = getTakeProfitRuntimeState(symbolKey, leg);
  const currentMaxPNL = runtime.peakUnrealizedPct;

  const stopCfg = getStopLossConfigForNext(symbolOptions, next);
  const stopLossAging = (stopCfg?.agingPerHour ?? 0) * hoursSinceLastTrade;
  const atrCfg: StopLossAtrConfig | undefined = stopCfg
    ? {
        atrScale: stopCfg.atrScale,
        atrMultiplier: stopCfg.atrMultiplier,
        atrMin: stopCfg.atrMin,
        atrMax: stopCfg.atrMax,
      }
    : undefined;
  // STOP_LOSS is absolute unrealized PNL % threshold; aging moves threshold over time.
  let stopLoss = effectiveStopLossPnl(stopCfg?.pnl ?? 0, ctx?.atrPct, atrCfg) + stopLossAging;

  // Ensure stopLoss is not positive
  if (stopLoss > 0) {
    stopLoss = 0;
  }

  /** Informatiivinen trigger-viiva lokiin (ei päätöksessä käytettä limit-lattiaa). */
  const takeProfit = currentMaxPNL - (tpCfg?.drop ?? 0);

  // Approximate how many primary timeframe candles have passed since the last trade
  let candlesSinceLastTrade = 0;
  const primaryInterval = symbolOptions.timeframes?.[0];
  if (primaryInterval) {
    const intervalSeconds = getSecondsFromInterval(primaryInterval);
    if (intervalSeconds > 0) {
      const elapsedSeconds = (closeTime - lastTrade.time) / 1000;
      candlesSinceLastTrade = Math.floor(elapsedSeconds / intervalSeconds);
    }
  }

  let effectiveTrend = symbolOptions.trend?.current ?? "LONG";
  if (symbolOptions.trend?.enabled) {
    if (newTrend === "SHORT" && effectiveTrend === "LONG") {
      effectiveTrend = "SHORT";
      symbolOptions.trend.current = "SHORT";
    } else if (newTrend === "LONG" && effectiveTrend === "SHORT") {
      effectiveTrend = "LONG";
      symbolOptions.trend.current = "LONG";
    } else if (!["LONG", "SHORT"].includes(effectiveTrend)) {
      effectiveTrend = "LONG";
      symbolOptions.trend.current = "LONG";
    }
  }

  const profitMins = resolveEffectiveProfitMinimums(symbolOptions, { effectiveTrend });
  const minProfitSell = profitMins.minSell;
  const minProfitBuy = profitMins.minBuy;

  const shouldTakeProfit = evaluateTakeProfitTrailing(unrealizedPNL, tpCfg, runtime);

  const shouldStopLoss = unrealizedPNL <= stopLoss;
  /** BUY + SL buy täppä päällä → vain buy-SL; muuten (myös BUY ilman täppää) → pää-stop lossin enabled. */
  const useBuyStopLoss = next === "BUY" && symbolOptions.stopLossBuy?.enabled === true;
  const stopLossEnabled = useBuyStopLoss ? true : symbolOptions.stopLoss?.enabled === true;

  // Decision-making based on trend and next action
  if (effectiveTrend === "LONG") {
    if (next === "SELL") {
      if (tpCfg?.enabled && shouldTakeProfit) {
        check = "TAKE_PROFIT";
      } else if (stopLossEnabled && shouldStopLoss) {
        check = "STOP_LOSS";
      } else if (unrealizedPNL < minProfitSell && minProfitSell !== 0) {
        check = "HOLD";
      } else {
        check = "SELL";
      }
    } else if (next === "BUY") {
      if (tpCfg?.enabled && shouldTakeProfit) {
        check = "TAKE_PROFIT";
      } else if (stopLossEnabled && shouldStopLoss) {
        check = "STOP_LOSS";
      } else if (unrealizedPNL < minProfitBuy && minProfitBuy !== 0) {
        check = "HOLD";
      } else {
        check = "BUY";
      }
    } else if (next === "BOTH") {
      if (tpCfg?.enabled && shouldTakeProfit) {
        check = "TAKE_PROFIT";
      } else if (stopLossEnabled && shouldStopLoss) {
        check = "STOP_LOSS";
      } else if (unrealizedPNL < minProfitSell && minProfitSell !== 0) {
        check = "HOLD";
      } else {
        check = "SELL";
      }
    }
  } else if (effectiveTrend === "SHORT") {
    if (next === "SELL") {
      if (tpCfg?.enabled && shouldTakeProfit) {
        check = "TAKE_PROFIT";
      } else if (stopLossEnabled && shouldStopLoss) {
        check = "STOP_LOSS";
      } else if (unrealizedPNL < minProfitSell && minProfitSell !== 0) {
        check = "HOLD";
      } else {
        check = "SELL";
      }
    } else if (next === "BUY" || next === "BOTH") {
      if (tpCfg?.enabled && shouldTakeProfit) {
        check = "TAKE_PROFIT";
      } else if (stopLossEnabled && shouldStopLoss) {
        check = "STOP_LOSS";
      } else if (unrealizedPNL < minProfitBuy && minProfitBuy !== 0) {
        check = "HOLD";
      } else {
        check = "BUY";
      }
    }
  } else {
    // If trend is not enabled, fallback to basic conditions
    if (tpCfg?.enabled && shouldTakeProfit) {
      check = "TAKE_PROFIT";
    } else if (stopLossEnabled && shouldStopLoss) {
      check = "STOP_LOSS";
    } else if (next === "SELL" && (unrealizedPNL >= minProfitSell || minProfitSell === 0)) {
      check = "SELL";
    } else if (next === "BUY" && (unrealizedPNL >= minProfitBuy || minProfitBuy === 0)) {
      check = "BUY";
    }
  }

  /**
   * Vähimmäisaika edelliseen kauppaan (tunteina): estä tavalliset SELL/BUY -signaalit ennen kuin tauko täyttyy.
   * TP/SL eivät kuulu tauon taakse (sulku ja riskinhallinta).
   */
  if (
    symbolOptions.minimumTimeSinceLastTrade > 0 &&
    timeSinceLastTrade < symbolOptions.minimumTimeSinceLastTrade &&
    (check === "SELL" || check === "BUY")
  ) {
    check = "HOLD";
  }

  // Force closing the position after N candles when price change is at least configured threshold
  const forceExitEnabled = symbolOptions.forcedExit?.enabled ?? true;
  const forceExitCandles = symbolOptions.forcedExit?.candles ?? 3;
  const forceExitChangeThreshold = symbolOptions.forcedExit?.change ?? 0.2;
  const forceExitMinProfit = symbolOptions.forcedExit?.minProfit;
  if (
    forceExitEnabled &&
    candlesSinceLastTrade >= forceExitCandles &&
    Math.abs(unrealizedPNL) >= forceExitChangeThreshold &&
    check !== "TAKE_PROFIT" &&
    check !== "TAKE_PROFIT_FORCE" &&
    check !== "STOP_LOSS"
  ) {
    if (forceExitMinProfit != null && unrealizedPNL < forceExitMinProfit) {
      // Unrealized PNL below configured minimum – skip forced exit to prevent loss trades
    } else {
      const forcedDirection = lastTrade.isBuyer ? "SELL" : "BUY";
      if (next === forcedDirection || next === "BOTH") {
        check = forcedDirection;
      }
    }
  }

  check = applyTakeProfitForceAfter({
    check,
    next,
    unrealizedPNL,
    peakUnrealizedPct: currentMaxPNL,
    candlesSinceLastTrade,
    effectiveTrend,
    tpCfg,
  });

  // Prevent normal SELL/BUY when unrealized PNL is negative;
  // only explicit PNL logic (STOP_LOSS / TAKE_PROFIT / TAKE_PROFIT_FORCE) may close a losing trade.
  if (check === "SELL" && unrealizedPNL < 0) {
    check = "HOLD";
  }
  if (check === "BUY" && unrealizedPNL < 0) {
    check = "HOLD";
  }

  // Time-stop: free capital after maxHours even if red. STALE_EXIT = profit override (scout/gates).
  const staleMaxHours = Number(symbolOptions.forcedExit?.maxHours);
  if (
    forceExitEnabled &&
    Number.isFinite(staleMaxHours) &&
    staleMaxHours > 0 &&
    timeSinceLastTrade >= staleMaxHours &&
    check !== "TAKE_PROFIT" &&
    check !== "TAKE_PROFIT_FORCE" &&
    check !== "STOP_LOSS" &&
    check !== "STALE_EXIT"
  ) {
    const forcedDirection = lastTrade.isBuyer ? "SELL" : "BUY";
    if (next === forcedDirection || next === "BOTH") {
      check = "STALE_EXIT";
    }
  }

  if (check === "STOP_LOSS") {
    markStopLossHit(symbolOptions, next);
  }

  return {
    check,
    takeProfit,
    stopLoss,
  };
};

/** Aseta stopLoss.hit kun SL-signaali laukeaa (sim stopTrading + live seuranta). */
export const markStopLossHit = (symbolOptions: SymbolOptions, next: string): void => {
  const useBuySl = next === "BUY" && symbolOptions.stopLossBuy?.enabled === true;
  if (useBuySl) {
    if (!symbolOptions.stopLossBuy) {
      symbolOptions.stopLossBuy = { enabled: true, pnl: -1, agingPerHour: 0, hit: true };
    } else {
      symbolOptions.stopLossBuy.hit = true;
    }
    return;
  }
  if (symbolOptions.stopLoss) {
    symbolOptions.stopLoss.hit = true;
  }
};

/** True when we are allowed to update takeProfit.current (currentMax) this tick. */
const shouldUpdateCurrentMaxForNext = (symbolOptions: SymbolOptions, next: string, isFinalCandle: boolean): boolean => {
  const source = getTakeProfitConfigForNext(symbolOptions, next)?.currentMaxSource ?? "update";
  if (source === "update") return true;
  if (source === "final") return isFinalCandle;
  return false; // "trade" → only updated in sell/buy
};

export const checkProfitSignals = async (
  consoleLogger: ConsoleLogger,
  next: string,
  trend: string,
  orderBook: Orderbook,
  closeTime: number,
  ExchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  isFinalCandle: boolean = true,
  ctx?: ProfitSignalContext
) => {
  let check = "HOLD";
  let lastPNL: number = 0;
  let unrealizedPNL: number = 0;
  const symbolKey = toSymbolKey(symbolOptions.name);
  const th = ExchangeOptions.tradeHistory?.[symbolKey];
  if (th?.length > 0) {
    const lastTrade = th[th.length - 1];
    const entryTrade = resolveOpenPositionEntryTrade(th, symbolKey) ?? lastTrade;
    // previous = realized PNL % of last closed round-trip (olderTrade -> lastTrade)
    if (th.length > 1) {
      const olderTrade = th[th.length - 2];
      if (olderTrade.isBuyer) {
        lastPNL = calculatePNLPercentageForLong(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
      } else {
        lastPNL = calculatePNLPercentageForShort(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
      }
    }
    if (entryTrade.isBuyer) {
      // selling
      const orderBookAsks = Object.keys(orderBook.asks)
        .map((price) => parseFloat(price))
        .sort((a, b) => a - b);
      unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
        parseFloat(entryTrade.qty),
        parseFloat(entryTrade.price),
        orderBookAsks[0]
      );
    } else if (!entryTrade.isBuyer) {
      // buying
      const orderBookBids = Object.keys(orderBook.bids)
        .map((price) => parseFloat(price))
        .sort((a, b) => b - a);
      unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
        parseFloat(entryTrade.qty),
        parseFloat(entryTrade.price),
        orderBookBids[0]
      );
    }
    unrealizedPNL = applyFeeAdjustmentToPnl(unrealizedPNL, symbolOptions.tradeFeePercentage, entryTrade);
    if (entryTrade.isBuyer && next === "BUY") {
      unrealizedPNL = -unrealizedPNL;
    } else if (!entryTrade.isBuyer && next === "SELL") {
      unrealizedPNL = -unrealizedPNL;
    }
    const tpCfg = getTakeProfitConfigForNext(symbolOptions, next);
    const leg = resolveTakeProfitLeg(symbolOptions, next);
    if (tpCfg !== undefined) {
      updateTakeProfitRuntimeState({
        symbolKey,
        leg,
        unrealizedPNL,
        armMinimum: tpCfg.minimum ?? 0,
        allowPeakUpdate: shouldUpdateCurrentMaxForNext(symbolOptions, next, isFinalCandle),
        tpCfg,
      });
    }
    const runtime = getTakeProfitRuntimeState(symbolKey, leg);
    const signals = await calculateProfitSignals(
      trend,
      next,
      entryTrade,
      lastPNL,
      unrealizedPNL,
      closeTime,
      symbolOptions,
      ctx
    );
    check = signals.check;
    consoleLogger.push("PNL%", {
      trend: trend,
      previous: lastPNL,
      unrealized: unrealizedPNL,
      currentMax: tpCfg?.current ?? symbolOptions.takeProfit?.current,
      tpArmed: runtime.armed,
      tpPeak: runtime.peakUnrealizedPct,
      stopLoss: signals.stopLoss < 0 ? signals.stopLoss : 0,
      takeProfit: signals.takeProfit,
      next: next,
      direction: check,
    });
  } else {
    check = "SKIP";
    consoleLogger.push("PNL%", {
      trend: trend,
      previous: 0,
      unrealized: 0,
      currentMax: 0,
      stopLoss: 0,
      takeProfit: 0,
      next: next,
      direction: check,
    });
  }
  return check;
};

export const checkProfitSignalsFromCandlesticks = async (
  consoleLogger: ConsoleLogger,
  next: string,
  trend: string,
  candlesticks: Candlestick[],
  closeTime: number,
  ExchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  isFinalCandle: boolean = true,
  ctx?: ProfitSignalContext
) => {
  let check = "HOLD";
  let lastPNL: number = 0;
  let unrealizedPNL: number = 0;
  if (!candlesticks?.length) return check;
  const symbolKeyC = toSymbolKey(symbolOptions.name);
  const thC = ExchangeOptions.tradeHistory?.[symbolKeyC];
  if (thC?.length > 0) {
    const lastTrade = thC[thC.length - 1];
    const entryTrade = resolveOpenPositionEntryTrade(thC, symbolKeyC) ?? lastTrade;
    if (thC.length > 1) {
      const olderTrade = thC[thC.length - 2];
      if (olderTrade.isBuyer) {
        lastPNL = calculatePNLPercentageForLong(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
      } else {
        lastPNL = calculatePNLPercentageForShort(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
      }
    }
    const close = candlesticks[candlesticks.length - 1].close;
    if (entryTrade.isBuyer === true) {
      unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
        parseFloat(entryTrade.qty),
        parseFloat(entryTrade.price),
        close
      );
    } else {
      unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
        parseFloat(entryTrade.qty),
        parseFloat(entryTrade.price),
        close
      );
    }
    unrealizedPNL = applyFeeAdjustmentToPnl(unrealizedPNL, symbolOptions.tradeFeePercentage, entryTrade);
    if (entryTrade.isBuyer && next === "BUY") {
      unrealizedPNL = -unrealizedPNL;
    } else if (!entryTrade.isBuyer && next === "SELL") {
      unrealizedPNL = -unrealizedPNL;
    }
    const tpCfg = getTakeProfitConfigForNext(symbolOptions, next);
    const leg = resolveTakeProfitLeg(symbolOptions, next);
    if (tpCfg !== undefined) {
      updateTakeProfitRuntimeState({
        symbolKey: symbolKeyC,
        leg,
        unrealizedPNL,
        armMinimum: tpCfg.minimum ?? 0,
        allowPeakUpdate: shouldUpdateCurrentMaxForNext(symbolOptions, next, isFinalCandle),
        tpCfg,
      });
    }
    const runtime = getTakeProfitRuntimeState(symbolKeyC, leg);
    const signals = await calculateProfitSignals(
      trend,
      next,
      entryTrade,
      lastPNL,
      unrealizedPNL,
      closeTime,
      symbolOptions,
      ctx
    );
    check = signals.check;
    consoleLogger.push("PNL%", {
      previous: lastPNL,
      unrealized: unrealizedPNL,
      currentMax: tpCfg?.current ?? symbolOptions.takeProfit?.current,
      tpArmed: runtime.armed,
      tpPeak: runtime.peakUnrealizedPct,
      stopLoss: signals.stopLoss,
      takeProfit: signals.takeProfit,
      direction: check,
    });
  } else {
    check = "SKIP";
    consoleLogger.push("PNL%", {
      previous: 0,
      unrealized: 0,
      currentMax: 0,
      stopLoss: 0,
      takeProfit: 0,
      direction: check,
    });
  }
  return check;
};
