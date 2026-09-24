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

import { Client } from "discord.js";
import { Filter } from "../Exchanges/Filters";
import { ConfigOptions, ExchangeOptions, SymbolOptions, getSecondsFromInterval, toSymbolKey } from "../Utilities/Args";
import { ConsoleLogger, consoleLogger } from "../Utilities/ConsoleLogger";
import { calculateEMA, ema, checkEMASignals, checkTrendSignal, Trend } from "../Indicators/EMA";
import { calculateRSI, checkRSISignals, logRSISignals } from "../Indicators/RSI";
import { calculateMACD, checkMACDSignals, logMACDSignals, macd } from "../Indicators/MACD";
import { Candlestick, Candlesticks } from "../Exchanges/Candlesticks";
import { calculateSMA, checkSMASignals, logSMASignals } from "../Indicators/SMA";
import { calculateATR, logATRSignals } from "../Indicators/ATR";
import {
  calculateBollingerBands,
  checkBollingerBandsSignals,
  logBollingerBandsSignals,
} from "../Indicators/BollingerBands";
import {
  calculateStochasticOscillator,
  calculateStochasticRSI,
  checkStochasticOscillatorSignals,
  checkStochasticRSISignals,
  logStochasticOscillatorSignals,
  logStochasticRSISignals,
} from "../Indicators/StochasticOscillator";
import { mayExecuteAlgorithmicTrade } from "../Trading/tradeGates";
import {
  consecutiveLossSkipsRemaining,
  isAlgorithmicEntryTrade,
} from "../Trading/consecutiveLossGuard";
import { hasOpenAlgorithmicPosition, hasTradeHistory } from "../Trading/positionState";
import { simSellPriceFromCandle, simBuyPriceFromCandle, simSellBaseQuantity } from "../Trading/executionSizing";
import {
  evaluateAlgorithmicTickPolicy,
  evaluateSimAlgorithmicTickPolicy,
  withSymbolAlgorithmicLock,
} from "./algorithmicExecution";
import {
  throttleKeyTradeHistory,
  throttleKeyBalances,
  shouldFetchData,
  markDataFetched,
  invalidateDataFetch,
} from "../Utilities/DataFetchThrottle";
import { buy, getTradeHistory, sell, simulateBuy, simulateSell } from "../Exchanges/Trades";
import { calculateOBV, checkOBVSignals, logOBVSignals } from "../Indicators/OBV";
import { calculateCMF, checkCMFSignals, logCMFSignals } from "../Indicators/CMF";
import { symbolFilters } from "../symbolFiltersStore";
import { checkGPTSignals } from "../Indicators/GPT";
import { Orderbook } from "../Exchanges/Orderbook";
import { checkProfitSignals, checkProfitSignalsFromCandlesticks } from "../Indicators/Profit";
import { atrPctFromSeries } from "../Trading/stopLossAtr";
import { checkBalanceSignals } from "../Indicators/Balance";
import { Balances, assignCurrentBalances, tradableBalance } from "../Exchanges/Balances";
import { RenkoBrick, calculateBrickSize, calculateRenko, checkRenkoSignals } from "../Indicators/Renko";
import { Exchange } from "../Exchanges/Exchange";
import { logToFile } from "../Utilities/LogToFile";
import { calculateDMI, checkDMISignals, DMI, logDMISignals } from "../Indicators/DMI";
import { getOpenOrders, handleOpenOrder, handleOpenOrders } from "../Exchanges/Orders";
import { adx, calculateADX, checkADXSignals, logADXSignals } from "../Indicators/ADX";
import {
  isProfitDirectionOverride,
  resolveAlgorithmicAdaptiveConfig,
  resolveEffectiveAgreement,
  resolveVolatilityMultiplier,
  shouldBlockCounterTrendEntry,
  withAdaptiveProfitScaling,
} from "./algorithmicAdaptive";
import { resolvePartialTakeProfitBaseQty, noteTakeProfitFillOutcome } from "../Trading/partialTakeProfit";
import { recordCounterTrendBlock } from "../Trading/counterTrendStats";
import { resolveScoutConfirmConfig, resolveScoutConfirmEntryDirection } from "./scoutConfirm";
import { resolveMacdParams } from "../Indicators/indicatorParams";
import { restoreIndicatorWeights, snapshotIndicatorWeights } from "../Indicators/indicatorVoteWeights";
import {
  buildIndicatorsCalcFingerprint,
  getCachedIndicatorCalc,
  setCachedIndicatorCalc,
} from "../Indicators/indicatorCalcCache";

export interface Indicators {
  trend: Trend;
  avg: {
    [time: string]: number;
  };
  renko: {
    [time: string]: RenkoBrick[];
  };
  ema: {
    [time: string]: ema;
  };
  adx: {
    [time: string]: adx;
  };
  macd: {
    [time: string]: macd;
  };
  sma: {
    [time: string]: number[];
  };
  rsi: {
    [time: string]: number[];
  };
  atr: {
    [time: string]: number[];
  };
  obv: {
    [time: string]: number[];
  };
  cmf: {
    [time: string]: number[];
  };
  stochasticOscillator: {
    [time: string]: [number[], number[]];
  };
  stochasticRSI: {
    [time: string]: [number[], number[]];
  };
  bollingerBands: {
    [time: string]: [number[], number[], number[]];
  };
  dmi: {
    [time: string]: DMI;
  };
  [key: string]: {};
}

export const reverseSign = (number: number) => {
  return -number;
};

interface Weights {
  [key: string]: number;
}

interface Checks {
  [key: string]: string;
}

interface Directions {
  [key: string]: number;
}

export const tradeDirection = async (
  consoleLogger: ConsoleLogger,
  symbol: string,
  orderBook: Orderbook | undefined,
  candlesticks: Candlesticks,
  indicators: Indicators,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  filter: Filter,
  isFinalCandle: boolean = true
): Promise<string[]> => {
  const startTime = Date.now();
  const symbolKey = toSymbolKey(symbol);
  const storeBySymbol = candlesticks[symbolKey];
  const timeframeKeys = storeBySymbol != null ? Object.keys(storeBySymbol) : [];
  const primaryTimeframe =
    symbolOptions.timeframes?.[0] != null && storeBySymbol?.[symbolOptions.timeframes[0]] != null
      ? symbolOptions.timeframes[0]
      : timeframeKeys[0];
  const series = primaryTimeframe != null ? storeBySymbol?.[primaryTimeframe] : undefined;
  const timeframes = symbolOptions.timeframes;

  let direction = "HOLD";
  const directions: Directions = {
    BUY: 0,
    SELL: 0,
    HOLD: 0,
  };
  let actions = ["BUY", "SELL", "HOLD"];
  let profit = "SKIP";

  if (!Array.isArray(series) || series.length === 0) {
    if (process.env.DEBUG === "true") {
      console.log(`Cant find candles for symbol ${symbol} (key=${symbolKey}, timeframes=[${timeframeKeys.join(",")}], primary=${primaryTimeframe ?? "n/a"})`);
    }
    return ["HOLD", "HOLD"];
  }

  const closePrice = series[series.length - 1].close;
  const closeTime = series[series.length - 1].time;
  const next = checkBalanceSignals(consoleLogger, symbol, closePrice, exchangeOptions, filter);
  const trend = checkTrendSignal(indicators.trend);
  const adaptiveCfg = resolveAlgorithmicAdaptiveConfig(symbolOptions);
  const primaryTf = primaryTimeframe ?? timeframes[0];
  const atrSeries = primaryTf != null ? indicators.atr[primaryTf] : undefined;
  const volMult =
    adaptiveCfg.enabled && symbolOptions.indicators !== undefined
      ? resolveVolatilityMultiplier(series, atrSeries, closePrice, adaptiveCfg)
      : 1;
  const profitSymbolOptions =
    adaptiveCfg.enabled && symbolOptions.indicators !== undefined
      ? withAdaptiveProfitScaling(symbolOptions, volMult, adaptiveCfg)
      : symbolOptions;
  if (adaptiveCfg.enabled && volMult !== 1) {
    consoleLogger.push("Adaptive volMult", volMult.toFixed(3));
  }
  const atrPct = atrPctFromSeries(atrSeries, closePrice, adaptiveCfg.atrLookback);
  const profitCtx = atrPct != null ? { atrPct } : undefined;
  if (orderBook !== undefined) {
    profit = await checkProfitSignals(
      consoleLogger,
      next,
      trend,
      orderBook,
      closeTime,
      exchangeOptions,
      profitSymbolOptions,
      isFinalCandle,
      profitCtx
    );
  } else {
    profit = await checkProfitSignalsFromCandlesticks(
      consoleLogger,
      next,
      trend,
      series,
      closeTime,
      exchangeOptions,
      profitSymbolOptions,
      isFinalCandle,
      profitCtx
    );
  }
  if (symbolOptions.indicators === undefined) {
    if (isProfitDirectionOverride(profit)) {
      return [profit, next];
    }
    return [profit, "HOLD"];
  }
  const baseIndicatorWeights = snapshotIndicatorWeights(symbolOptions.indicators);
  const scoutCfg = resolveScoutConfirmConfig(symbolOptions);
  if (scoutCfg.enabled) {
    const entry = resolveScoutConfirmEntryDirection({
      consoleLogger,
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
    });
    direction = entry.direction;
    consoleLogger.push("Scout/Confirm", entry.debug);
    consoleLogger.push("Directions (confirm)", entry.confirmDirections);
    if (adaptiveCfg.enabled && entry.debug.agreement) {
      consoleLogger.push("Adaptive agreement", entry.debug.agreement);
    }
  } else {
  for (let timeframeIndex = 0; timeframeIndex < timeframes.length; timeframeIndex++) {
    restoreIndicatorWeights(symbolOptions.indicators, baseIndicatorWeights);
    const checks: Checks = {
      SMA: checkSMASignals(indicators.sma[timeframes[timeframeIndex]], symbolOptions),
      Renko: checkRenkoSignals(indicators.renko[timeframes[timeframeIndex]], symbolOptions),
      EMA: checkEMASignals(indicators.ema[timeframes[timeframeIndex]], symbolOptions),
      ADX: checkADXSignals(indicators.adx[timeframes[timeframeIndex]], symbolOptions),
      MACD: checkMACDSignals(indicators.macd[timeframes[timeframeIndex]], symbolOptions),
      RSI: checkRSISignals(indicators.rsi[timeframes[timeframeIndex]], symbolOptions),
      StochasticOscillator: checkStochasticOscillatorSignals(
        indicators.stochasticOscillator[timeframes[timeframeIndex]],
        symbolOptions
      ),
      StochasticRSI: checkStochasticRSISignals(indicators.stochasticRSI[timeframes[timeframeIndex]], symbolOptions),
      BollingerBands: checkBollingerBandsSignals(
        candlesticks[toSymbolKey(symbol)][timeframes[timeframeIndex]],
        indicators.bollingerBands[timeframes[timeframeIndex]],
        symbolOptions
      ),
      OBV: checkOBVSignals(
        candlesticks[toSymbolKey(symbol)][timeframes[timeframeIndex]],
        indicators.obv[timeframes[timeframeIndex]],
        symbolOptions
      ),
      CMF: checkCMFSignals(indicators.cmf[timeframes[timeframeIndex]], symbolOptions),
      DMI: checkDMISignals(indicators.dmi[timeframes[timeframeIndex]], symbolOptions),
    };
    const keys = Object.keys(checks).filter((check) => checks[check] !== "SKIP");
    // console.log(`Keys: ${JSON.stringify(keys)}`);
    const keysLength = keys.length;
    const weights: Weights = {
      SMAWeight: symbolOptions.indicators.sma?.weight ?? 0,
      EMAWeight: symbolOptions.indicators.ema?.weight ?? 0,
      ADXWeight: symbolOptions.indicators.adx?.weight ?? 0,
      MACDWeight: symbolOptions.indicators.macd?.weight ?? 0,
      RSIWeight: symbolOptions.indicators.rsi?.weight ?? 0,
      StochasticOscillatorWeight: symbolOptions.indicators.so?.weight ?? 0,
      StochasticRSIWeight: symbolOptions.indicators.srsi?.weight ?? 0,
      BollingerBandsWeight: symbolOptions.indicators.bb?.weight ?? 0,
      OBVWeight: symbolOptions.indicators.obv?.weight ?? 0,
      CMFWeight: symbolOptions.indicators.cmf?.weight ?? 0,
      RenkoWeight: symbolOptions.indicators.renko?.weight ?? 0,
      DMIWeight: symbolOptions.indicators.dmi?.weight ?? 0,
    };
    if (process.env.DEBUG === "true") {
      consoleLogger.push(`Indicator checks ${timeframes[timeframeIndex]}`, checks);
    }
    for (let actionsIndex = 0; actionsIndex < actions.length; actionsIndex++) {
      let weightedSum = 0;
      let totalWeight = 0;
      // console.log(`Keys length: ${keys.length}`);
      // console.log(`Constant keys length: ${keysLength}`);
      for (let keysIndex = 0; keysIndex < keysLength; keysIndex++) {
        const weight = weights[`${keys[keysIndex]}Weight`];
        // console.log(`weights[${`${keys[keysIndex]}Weight`}] = ${weight}`);
        const signal = checks[keys[keysIndex]];
        if (signal === actions[actionsIndex]) {
          weightedSum += weight;
        } else if (signal === "BOTH" && (actions[actionsIndex] === "SELL"  || actions[actionsIndex] === "BUY")) {
          weightedSum += weight;
        }
        totalWeight += weight;
      }
      // console.log(`Action Index: ${actions[actionsIndex]}`);
      // console.log(`weightedSum: ${weightedSum}`);
      // console.log(`totalWeight: ${totalWeight}`);
      if (totalWeight > 0) {
        const percentage = ((weightedSum / totalWeight) * 100) / timeframes.length;
        // console.log(`percentage:${percentage}`);
        directions[actions[actionsIndex]] += percentage;
      }
    }
  }
  consoleLogger.push("Directions", directions);
  actions = actions.filter((action) => directions[action] !== undefined);
  const profitOverride = isProfitDirectionOverride(profit);
  const agreementMeta = resolveEffectiveAgreement({
    baseAgreement: symbolOptions.agreement,
    volMult,
    cfg: adaptiveCfg,
    next,
    trend,
    directions,
    closeTime,
    symbolOptions,
    exchangeOptions,
  });
  if (adaptiveCfg.enabled) {
    consoleLogger.push("Adaptive agreement", {
      base: symbolOptions.agreement,
      effective: agreementMeta.effective,
      conflict: agreementMeta.conflict,
      volDelta: agreementMeta.volDelta,
      trendDelta: agreementMeta.trendDelta,
      ease: agreementMeta.ease,
    });
  }
  if (agreementMeta.conflict && !profitOverride) {
    // Konfliktin vaikutus on conflictPenalty effective-agreementissa — ei erillistä hard-HOLD:ia,
    // muuten conflictPenalty=0 / agreementEase eivät voi avata entryä.
    consoleLogger.push("Vote conflict (agreement raised)", {
      effective: agreementMeta.effective,
      directions,
    });
  }
  if (directions[next] >= agreementMeta.effective) {
    direction = next;
  } else if (profitOverride) {
    direction = next;
  } else {
    direction = "HOLD";
  }
  }

  if (symbolOptions.indicators?.OpenAI !== undefined && symbolOptions.indicators.OpenAI.enabled) {
    const checkGPT = await checkGPTSignals(consoleLogger, symbol, candlesticks, indicators, symbolOptions);
    if (symbolOptions.indicators.OpenAI.overwrite === true) {
      direction = checkGPT;
    } else {
      if (checkGPT !== "SKIP" && checkGPT !== direction) {
        direction = "HOLD";
      }
    }
  }
  if (
    direction !== "HOLD" &&
    shouldBlockCounterTrendEntry(direction, profit, trend, adaptiveCfg)
  ) {
    consoleLogger.push("Counter-trend entry blocked", { direction, profit, trend });
    recordCounterTrendBlock(toSymbolKey(symbol), direction, trend);
    direction = "HOLD";
  }
  // if (direction === "SELL") {
  //   console.log(`
  //   _______________________
  //   |  _________________  |
  //   | |       SELL   /  | |
  //   | |       /\\    /   | |
  //   | |  /\\  /  \\  /    | |
  //   | | /  \\/    \\/     | |
  //   | |/                | |
  //   | |_________________| |
  //   |  ___ ___ ___   ___  |
  //   | | 7 | 8 | 9 | | + | |
  //   | |___|___|___| |___| |
  //   | | 4 | 5 | 6 | | - | |
  //   | |___|___|___| |___| |
  //   | | 1 | 2 | 3 | | x | |
  //   | |___|___|___| |___| |
  //   | | . | 0 | = | | / | |
  //   | |___|___|___| |___| |
  //   |_____________________|
  //   `);
  // } else if (direction === "BUY") {
  //   console.log(`
  //   _______________________
  //   |  _________________  |
  //   | |              /  | |
  //   | |       /\\    /   | |
  //   | |  /\\  /  \\  /    | |
  //   | | /  \\/    \\/     | |
  //   | |/          BUY   | |
  //   | |_________________| |
  //   |  ___ ___ ___   ___  |
  //   | | 7 | 8 | 9 | | + | |
  //   | |___|___|___| |___| |
  //   | | 4 | 5 | 6 | | - | |
  //   | |___|___|___| |___| |
  //   | | 1 | 2 | 3 | | x | |
  //   | |___|___|___| |___| |
  //   | | . | 0 | = | | / | |
  //   | |___|___|___| |___| |
  //   |_____________________|
  //   `);
  // } else if (direction === "HOLD") {
  //   console.log(`
  //   _______________________
  //   |  _________________  |
  //   | |                 | |
  //   | |      HOLD       | |
  //   | |-----------------| |
  //   | |     WAITING     | |
  //   | |    FOR PULSE    | |
  //   | |_________________| |
  //   |  ___ ___ ___   ___  |
  //   | | 7 | 8 | 9 | | + | |
  //   | |___|___|___| |___| |
  //   | | 4 | 5 | 6 | | - | |
  //   | |___|___|___| |___| |
  //   | | 1 | 2 | 3 | | x | |
  //   | |___|___|___| |___| |
  //   | | . | 0 | = | | / | |
  //   | |___|___|___| |___| |
  //   |_____________________|
  //   `);
  // }
  consoleLogger.push("PROFIT Direction", profit);
  consoleLogger.push(`TRADE Direction`, direction);
  restoreIndicatorWeights(symbolOptions.indicators, baseIndicatorWeights);
  const stopTime = Date.now();
  consoleLogger.push(`Time to decide direction (ms)`, stopTime - startTime);
  return [profit, direction];
};

export const placeTrade = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  candlesticks: Candlesticks,
  filter: Filter,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  isFinalCandle: boolean = true
) => {
  const orderBook = exchangeOptions.orderbooks[toSymbolKey(symbol)];
  const indicators = calculateIndicators(symbol, candlesticks, symbolOptions, consoleLogger, {
    logIndicators: isFinalCandle || process.env.DEBUG === "true",
  });
  const [profit, direction] = await tradeDirection(
    consoleLogger,
    symbol,
    orderBook,
    candlesticks,
    indicators,
    exchangeOptions,
    symbolOptions,
    filter,
    isFinalCandle
  );
  var handledOpenOrders = true;
  const symbolKeyForOrders = toSymbolKey(symbol);
  const orderBookForGuard = exchangeOptions.orderbooks?.[symbolKeyForOrders];
  if (orderBookForGuard !== undefined) {
    const forceCancelOpenOrders =
      profit === "STOP_LOSS" ||
      profit === "TAKE_PROFIT" ||
      profit === "TAKE_PROFIT_FORCE" ||
      profit === "STALE_EXIT";
    handledOpenOrders = await handleOpenOrders(
      discord,
      exchange,
      symbol,
      orderBookForGuard,
      processOptions,
      symbolOptions,
      { forceCancelOpenOrders }
    );
  }
  // console.log(handledOpenOrders);
  if (handledOpenOrders) {
    const symbolKey = toSymbolKey(symbol);
    const symbolTrades = exchangeOptions.tradeHistory?.[symbolKey];
    const hasTradeHistoryFlag = hasTradeHistory(symbolTrades);
    const hasOpenPositionFlag = hasOpenAlgorithmicPosition(symbolTrades, symbolKey);
    const tradeGateOpts = {
      hasTradeHistory: hasTradeHistoryFlag,
      hasOpenPosition: hasOpenPositionFlag,
      symbolKey,
      symbolOptions,
    };
    const skipsBeforeEntry = consecutiveLossSkipsRemaining(symbolKey);
    const canExecute = mayExecuteAlgorithmicTrade(profit, direction, tradeGateOpts);
    if (
      !canExecute &&
      isAlgorithmicEntryTrade(direction, profit) &&
      skipsBeforeEntry > consecutiveLossSkipsRemaining(symbolKey)
    ) {
      consoleLogger.push("Entry blocked after losing round-trip", {
        profit,
        direction,
        skipsRemaining: consecutiveLossSkipsRemaining(symbolKey),
      });
    }
    if (canExecute && direction === "SELL") {
      logToFile(
        "./logs/debug.log",
        `const [${profit}, ${direction}] = await tradeDirection(consoleLogger, ${symbol}, orderBook, candlesticks, indicators, exchangeOptions, symbolOptions, filter);`
      );
      try {
        exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
        invalidateDataFetch(throttleKeyBalances(exchangeOptions.name));
      } catch (err) {
        consoleLogger.push("warning", `Balance refresh before SELL failed: ${String(err)}`);
      }
      const baseBal = tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]);
      const partialQty = resolvePartialTakeProfitBaseQty(baseBal, symbolOptions, profit, "SELL");
      return sell(
        discord,
        exchange,
        consoleLogger,
        symbol,
        profit,
        orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        partialQty
      );
    } else if (canExecute && direction === "BUY") {
      logToFile(
        "./logs/debug.log",
        `const [${profit}, ${direction}] = await tradeDirection(consoleLogger, ${symbol}, orderBook, candlesticks, indicators, exchangeOptions, symbolOptions, filter);`
      );
      try {
        exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
        invalidateDataFetch(throttleKeyBalances(exchangeOptions.name));
      } catch (err) {
        consoleLogger.push("warning", `Balance refresh before BUY failed: ${String(err)}`);
      }
      const baseBal = tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]);
      const partialQty = resolvePartialTakeProfitBaseQty(baseBal, symbolOptions, profit, "BUY");
      return buy(
        discord,
        exchange,
        consoleLogger,
        symbol,
        profit,
        orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        partialQty
      );
    }
  }
  return false;
};

const seedEmptyIndicatorSeries = (
  indicators: Indicators,
  timeframe: string,
  symbolOptions: SymbolOptions
): void => {
  const ind = symbolOptions.indicators;
  if (!ind) return;
  if (ind.macd?.enabled) {
    indicators.macd[timeframe] = { macdLine: [], signalLine: [], histogram: [] };
  }
  if (ind.rsi?.enabled) indicators.rsi[timeframe] = [];
  if (ind.adx?.enabled) indicators.adx[timeframe] = { adx: [], plusDI: [], minusDI: [] };
  if (ind.sma?.enabled) indicators.sma[timeframe] = [];
  if (ind.cmf?.enabled) indicators.cmf[timeframe] = [];
  if (ind.bb?.enabled) indicators.bollingerBands[timeframe] = [[], [], []];
  if (ind.obv?.enabled) indicators.obv[timeframe] = [];
  if (ind.so?.enabled) indicators.stochasticOscillator[timeframe] = [[], []];
  if (ind.srsi?.enabled) indicators.stochasticRSI[timeframe] = [[], []];
  if (ind.dmi?.enabled) indicators.dmi[timeframe] = { adx: [], plusDI: [], minusDI: [] };
  if (ind.ema?.enabled) indicators.ema[timeframe] = { short: [], long: [] };
};

const subCalculateIndicators = (
  candlesticks: Candlestick[],
  indicators: Indicators,
  timeframe: string,
  symbolOptions: SymbolOptions,
  consoleLogger: ConsoleLogger,
  logIndicators: boolean
) : Indicators => {
  if (symbolOptions.indicators !== undefined) {
    if (!Array.isArray(candlesticks) || candlesticks.length === 0) {
      seedEmptyIndicatorSeries(indicators, timeframe, symbolOptions);
      return indicators;
    }
    if (symbolOptions.indicators.sma?.enabled) {
      indicators.sma[timeframe] = calculateSMA(
        candlesticks,
        symbolOptions.indicators.sma.length,
        symbolOptions.source
      );
      if (logIndicators) logSMASignals(consoleLogger, indicators.sma[timeframe]);
    }
    if (symbolOptions.indicators.rsi?.enabled) {
      indicators.rsi[timeframe] = calculateRSI(
        candlesticks,
        symbolOptions.indicators.rsi.length,
        symbolOptions.indicators.rsi.smoothing?.type,
        symbolOptions.indicators.rsi.smoothing?.length,
        symbolOptions.source
      );
      if (logIndicators) logRSISignals(consoleLogger, indicators.rsi[timeframe]);
    }
    if (symbolOptions.indicators.adx?.enabled) {
      indicators.adx[timeframe] = calculateADX(
        candlesticks,
        symbolOptions.indicators.adx.dilength,
        symbolOptions.indicators.adx.adxSmoothing
      );
      if (logIndicators) logADXSignals(consoleLogger, indicators.adx[timeframe]);
    }
    if (symbolOptions.indicators.macd?.enabled) {
      const macdParams = resolveMacdParams(symbolOptions);
      indicators.macd[timeframe] = calculateMACD(
        candlesticks,
        macdParams.fast,
        macdParams.slow,
        macdParams.signal,
        symbolOptions.source
      );
      if (logIndicators) logMACDSignals(consoleLogger, indicators.macd[timeframe]);
    }
    if (symbolOptions.indicators.atr?.enabled && logIndicators) {
      logATRSignals(consoleLogger, indicators.atr[timeframe]);
    }
    if (symbolOptions.indicators.bb?.enabled) {
      const bbAvg =
        symbolOptions.indicators.bb.average === "EMA" ? "EMA" : "SMA";
      indicators.bollingerBands[timeframe] = calculateBollingerBands(
        candlesticks,
        bbAvg,
        symbolOptions.indicators.bb.length,
        symbolOptions.indicators.bb.multiplier,
        symbolOptions.source
      );
      if (logIndicators) {
        logBollingerBandsSignals(consoleLogger, candlesticks, indicators.bollingerBands[timeframe]);
      }
    }
    if (symbolOptions.indicators.so?.enabled) {
      indicators.stochasticOscillator[timeframe] = calculateStochasticOscillator(
        candlesticks,
        symbolOptions.indicators.so.kPeriod,
        symbolOptions.indicators.so.dPeriod,
        symbolOptions.indicators.so.smoothing
      );
      if (logIndicators) logStochasticOscillatorSignals(consoleLogger, indicators.stochasticOscillator[timeframe]);
    }
    if (symbolOptions.indicators.srsi?.enabled) {
      indicators.stochasticRSI[timeframe] = calculateStochasticRSI(
        candlesticks,
        symbolOptions.indicators.srsi.rsiLength,
        symbolOptions.indicators.srsi.stochLength,
        symbolOptions.indicators.srsi.smoothK,
        symbolOptions.indicators.srsi.smoothD,
        symbolOptions.indicators.rsi?.smoothing?.type,
        symbolOptions.source
      );
      if (logIndicators) logStochasticRSISignals(consoleLogger, indicators.stochasticRSI[timeframe]);
    }
    if (symbolOptions.indicators.obv?.enabled) {
      indicators.obv[timeframe] = calculateOBV(candlesticks);
      if (logIndicators) logOBVSignals(consoleLogger, candlesticks, indicators.obv[timeframe]);
    }
    if (symbolOptions.indicators.cmf?.enabled) {
      indicators.cmf[timeframe] = calculateCMF(candlesticks, symbolOptions.indicators.cmf.length);
      if (logIndicators) logCMFSignals(consoleLogger, indicators.cmf[timeframe], symbolOptions);
    }
    if (symbolOptions.indicators.dmi?.enabled) {
      indicators.dmi[timeframe] = calculateDMI(
        candlesticks,
        symbolOptions.indicators.dmi.dmiLength,
        symbolOptions.indicators.dmi.adxSmoothing
      );
      if (logIndicators) logDMISignals(consoleLogger, indicators.dmi[timeframe]);
    }
    return indicators;
  } else {
    return {
      trend: indicators.trend,
      avg: {},
      renko: {},
      ema: {},
      adx: {},
      macd: {},
      sma: {},
      rsi: {},
      atr: {},
      obv: {},
      cmf: {},
      stochasticOscillator: {},
      stochasticRSI: {},
      bollingerBands: {},
      dmi: {}
    };
  }
};

export const calculateIndicators = (
  symbol: string,
  candlesticks: Candlesticks,
  symbolOptions: SymbolOptions,
  consoleLogger: ConsoleLogger,
  opts?: { logIndicators?: boolean; useCache?: boolean }
): Indicators => {
  const symbolKey = toSymbolKey(symbol);
  const store = candlesticks[symbolKey];
  const timeframes = symbolOptions.timeframes ?? [];
  const logIndicators = opts?.logIndicators ?? process.env.DEBUG === "true";
  const useCache = opts?.useCache !== false;
  const seriesByTf: Record<string, Candlestick[] | undefined> = {};
  for (const tf of timeframes) {
    seriesByTf[tf] = store?.[tf];
  }
  const trendTf =
    symbolOptions.trend?.enabled && symbolOptions.trend.timeframe
      ? symbolOptions.trend.timeframe
      : undefined;
  if (trendTf) seriesByTf[trendTf] = store?.[trendTf];

  const fingerprint = buildIndicatorsCalcFingerprint({
    symbolKey,
    timeframes,
    trendTimeframe: trendTf,
    seriesByTf,
  });
  if (useCache) {
    const cached = getCachedIndicatorCalc<Indicators>(symbolKey, fingerprint);
    if (cached) return cached;
  }

  let indicators: Indicators = {
    trend: {},
    avg: {},
    sma: {},
    ema: {},
    adx: {},
    macd: {},
    rsi: {},
    atr: {},
    bollingerBands: {},
    stochasticOscillator: {},
    stochasticRSI: {},
    obv: {},
    cmf: {},
    dmi: {},
    renko: {},
  };
  if (trendTf && store?.[trendTf] !== undefined) {
    const trendShort =
      symbolOptions.trend?.ema?.short ?? symbolOptions.indicators?.ema?.short ?? 9;
    const trendLong =
      symbolOptions.trend?.ema?.long ?? symbolOptions.indicators?.ema?.long ?? 21;
    indicators.trend = {
      short: calculateEMA(store[trendTf], trendShort, "close"),
      long: calculateEMA(store[trendTf], trendLong, "close"),
    };
  }
  const needAtr =
    symbolOptions.indicators?.atr?.enabled === true ||
    symbolOptions.indicators?.renko?.enabled === true ||
    (symbolOptions.algorithmicAdaptive?.enabled !== false &&
      symbolOptions.algorithmicAdaptive?.volatilityScale !== false);
  for (let i = 0; i < timeframes.length; i++) {
    if (symbolOptions.indicators === undefined) continue;
    const tf = timeframes[i];
    const series = store?.[tf];
    if (symbolOptions.indicators.ema?.enabled) {
      indicators.ema[tf] = {
        short: calculateEMA(series, symbolOptions.indicators.ema.short, symbolOptions.source),
        long: calculateEMA(series, symbolOptions.indicators.ema.long, symbolOptions.source),
      };
    } else {
      indicators.ema[tf] = { short: [], long: [] };
    }
    if (needAtr) {
      indicators.atr[tf] = calculateATR(series, symbolOptions.indicators?.atr?.length, symbolOptions.source);
    } else {
      indicators.atr[tf] = [];
    }
    if (symbolOptions.indicators.renko !== undefined && symbolOptions.indicators.renko.enabled) {
      const brickSize = calculateBrickSize(indicators.atr[tf], symbolOptions);
      if (brickSize > 0 && Number.isFinite(brickSize)) {
        symbolOptions.indicators.renko.brickSize = brickSize;
        indicators.renko[tf] = calculateRenko(series, brickSize);
        indicators = subCalculateIndicators(
          indicators.renko[tf] as Candlestick[],
          indicators,
          tf,
          symbolOptions,
          consoleLogger,
          logIndicators
        );
      } else {
        seedEmptyIndicatorSeries(indicators, tf, symbolOptions);
      }
    } else if (Array.isArray(series) && series.length > 0) {
      indicators = subCalculateIndicators(series, indicators, tf, symbolOptions, consoleLogger, logIndicators);
    } else {
      seedEmptyIndicatorSeries(indicators, tf, symbolOptions);
    }
  }
  if (useCache) {
    setCachedIndicatorCalc(symbolKey, fingerprint, indicators);
  }
  return indicators;
};

export const algorithmic = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  candlesticks: Candlesticks,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  if (symbolOptions.enabled === false) return false;
  const symbolKey = toSymbolKey(symbol);
  return withSymbolAlgorithmicLock(symbolKey, async () => {
    return algorithmicUnlocked(
      discord,
      exchange,
      consoleLogger,
      symbol,
      symbolKey,
      candlesticks,
      processOptions,
      exchangeOptions,
      symbolOptions
    );
  });
};

const algorithmicUnlocked = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  symbolKey: string,
  candlesticks: Candlesticks,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const balancesKey = throttleKeyBalances(exchangeOptions.name);
  // Sama kuin Grid: päivitä saldot ~30 s välein (ei BTCEUR-avainta — balances on BTC/EUR).
  if (shouldFetchData(balancesKey)) {
    exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
    markDataFetched(balancesKey);
  } 
  const startTime = Date.now();
  const filter = symbolFilters[symbolKey];

  if (candlesticks[symbolKey] === undefined) {
    return false;
  }

  const timeframeKeys = Object.keys(candlesticks[symbolKey]);
  if (!Array.isArray(timeframeKeys) || timeframeKeys.length === 0) {
    return false;
  }

  const storeBySymbol = candlesticks[symbolKey];
  const primaryTimeframe =
    symbolOptions.timeframes?.[0] != null && storeBySymbol[symbolOptions.timeframes[0]] != null
      ? symbolOptions.timeframes[0]
      : timeframeKeys[0];
  const series = candlesticks[symbolKey][primaryTimeframe];

  if (!Array.isArray(series) || series.length < 2) {
    return false;
  }
  exchangeOptions.tradeHistory = exchangeOptions.tradeHistory || {};
  const tradeHistoryKey = throttleKeyTradeHistory(exchangeOptions.name, symbolKey);
  if (shouldFetchData(tradeHistoryKey)) {
    exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbol);
    markDataFetched(tradeHistoryKey);
  }
  if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
    console.error(`${symbol}: could not retrieve trade history`);
    return false;
  }
  const emaLong = symbolOptions.indicators?.ema?.long ?? 21;
  if (series.length < emaLong) {
    consoleLogger.push(`warning`, `Not enough candlesticks for calculations, please wait.`);
    return false;
  }

  const hasOpenPosition = hasOpenAlgorithmicPosition(exchangeOptions.tradeHistory[symbolKey], symbolKey);
  const tickPolicy = evaluateAlgorithmicTickPolicy(
    symbolKey,
    symbolOptions,
    candlesticks,
    hasOpenPosition
  );
  if (!tickPolicy.runFullDecision) {
    return false;
  }
  consoleLogger.push("Tick policy", tickPolicy);

  const latestCandle = series[series.length - 1];
  const prevCandle = series[series.length - 2];
  const candleTime = new Date(latestCandle.time).toLocaleString("fi-FI");
  consoleLogger.push("Symbol", toSymbolKey(symbol));
  if (exchangeOptions.tradeHistory[toSymbolKey(symbol)]?.length > 0) {
    const lastTradeTime =
      exchangeOptions.tradeHistory[toSymbolKey(symbol)][
        exchangeOptions.tradeHistory[toSymbolKey(symbol)].length - 1
      ].time;
    const lastTradeDate = new Date(lastTradeTime);
    consoleLogger.push("Last trade time", lastTradeDate.toLocaleString("fi-FI"));
  } else {
    consoleLogger.push("Last trade time", "No trades done!");
  }
  if (latestCandle !== undefined) {
    consoleLogger.push("Candlestick", {
      time: candleTime,
      open: latestCandle.open,
      high: latestCandle.high,
      low: latestCandle.low,
      close: latestCandle.close,
      color: latestCandle.close > latestCandle.open ? "Green" : "Red",
      direction:
        latestCandle.close > prevCandle?.close
          ? "Rising"
          : latestCandle.close < prevCandle?.close
          ? "Dropping"
          : "Stagnant",
      final: latestCandle.isFinal,
      candlesticks: series.length,
    });
  }
  const [baseCurrency, quoteCurrency] = symbol.split("/");
  const baseBalance = exchangeOptions.balances[baseCurrency]
    ? exchangeOptions.balances[baseCurrency].crypto.toFixed(7) + " " + baseCurrency
    : "0 " + baseCurrency;
  const quoteBalance = exchangeOptions.balances[quoteCurrency]
    ? exchangeOptions.balances[quoteCurrency].crypto.toFixed(7) + " " + quoteCurrency
    : "0 " + quoteCurrency;
  consoleLogger.push("Balance", {
    base: baseBalance,
    quote: quoteBalance,
  });
  const isFinalCandle = Boolean(latestCandle.isFinal);
  const placedTrade = await placeTrade(
    discord,
    exchange,
    consoleLogger,
    symbol,
    candlesticks,
    filter,
    processOptions,
    exchangeOptions,
    symbolOptions,
    isFinalCandle
  );
  const stopTime = Date.now();
  consoleLogger.push(`Calculation speed (ms)`, stopTime - startTime);
  if (latestCandle.isFinal === true && shouldFetchData(tradeHistoryKey)) {
    exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
    markDataFetched(tradeHistoryKey);
  }
  const updateColor = "blue";
  const tradeColor = "green";
  const consoleMode = (exchangeOptions.console ?? "").toString().trim();

  if (exchangeOptions.name === "binance" || exchangeOptions.name === "xeggex" || exchangeOptions.name === "nonkyc") {
    if (consoleMode === "trade/final" && (placedTrade !== false || isFinalCandle)) {
      consoleLogger.print(tradeColor);
      consoleLogger.flush();
    } else if (consoleMode === "trade/final" && placedTrade === false && !isFinalCandle) {
      consoleLogger.flush();
    } else if (consoleMode === "trade" && placedTrade !== false) {
      consoleLogger.print(tradeColor);
      consoleLogger.flush();
    } else if (consoleMode === "trade" && placedTrade === false) {
      consoleLogger.flush();
    } else if (consoleMode === "final" && isFinalCandle) {
      consoleLogger.print(tradeColor);
      consoleLogger.flush();
    } else if (consoleMode === "final" && !isFinalCandle) {
      consoleLogger.flush();
    } else {
      // "update" or any other mode: show updates in blue
      consoleLogger.print(updateColor);
      consoleLogger.flush();
    }
  }

  return true;
};

const getRandomValueBetween = (x: number, close: number): number => {
  const rangeStart = Math.min(x, close);
  const rangeEnd = Math.max(x, close);
  if (rangeEnd - rangeStart < 0.01) {
    return close;
  }
  const randomValue = Math.random() * (rangeEnd - rangeStart) + rangeStart;
  return Number(randomValue.toFixed(2));
};

export const simulateAlgorithmic = async (
  symbol: string,
  candlesticks: Candlesticks,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  balances: Balances,
  filter: Filter
) => {
  if (symbolOptions.enabled === false) return false;
  const logger = consoleLogger();
  const symbolKey = toSymbolKey(symbol);

  if (candlesticks[symbolKey] === undefined) {
    return false;
  }
  const timeframeKeys = Object.keys(candlesticks[symbolKey]);
  if (!Array.isArray(timeframeKeys) || timeframeKeys.length === 0) {
    return false;
  }

  const storeBySymbol = candlesticks[symbolKey];
  const primaryTimeframe =
    symbolOptions.timeframes?.[0] != null && storeBySymbol[symbolOptions.timeframes[0]] != null
      ? symbolOptions.timeframes[0]
      : timeframeKeys[0];
  const series = storeBySymbol[primaryTimeframe];

  if (!Array.isArray(series) || series.length < 2) {
    return false;
  }
  if (exchangeOptions.tradeHistory === undefined) {
    exchangeOptions.tradeHistory = {};
    exchangeOptions.tradeHistory[symbolKey] = [];
  }
  if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
    exchangeOptions.tradeHistory[symbolKey] = [];
  }
  const emaLongSim = symbolOptions.indicators?.ema?.long ?? 21;
  if (series.length < emaLongSim) {
    logger.push(`warning`, `Not enough candlesticks for calculations, please wait.`);
    return false;
  }

  const hasOpenPosition = hasOpenAlgorithmicPosition(exchangeOptions.tradeHistory[symbolKey], symbolKey);
  const simTick = evaluateSimAlgorithmicTickPolicy(symbolKey, symbolOptions, series, hasOpenPosition);
  if (!simTick.runFullDecision) {
    return false;
  }

  const latestCandle = series[series.length - 1];
  const prevCandle = series[series.length - 2];
  const candleTime = new Date(latestCandle.time).toLocaleString("fi-FI");
  logger.push("Symbol", toSymbolKey(symbol));
  // if (latestCandle !== undefined) {
  //   logger.push('Candlestick', {
  //     time: candleTime,
  //     color: (latestCandle.close > latestCandle.open) ? "Green" : "Red",
  //     direction: (latestCandle.close > prevCandle?.close) ? "Rising" : (latestCandle.close < prevCandle?.close) ? "Dropping" : "Stagnant",
  //     open: latestCandle?.open?.toFixed(7),
  //     close: latestCandle?.close?.toFixed(7),
  //     low: latestCandle?.low?.toFixed(7),
  //     high: latestCandle?.high?.toFixed(7)
  //   });
  // }
  logger.push("Time", candleTime);
  logger.push("Color", latestCandle.close > latestCandle.open ? "Green" : "Red");
  logger.push("Balance", {
    base: (exchangeOptions.balances?.[symbol.split("/")[0]]?.crypto ?? 0).toFixed(7) + " " + symbol.split("/")[0],
    quote: (exchangeOptions.balances?.[symbol.split("/")[1]]?.crypto ?? 0).toFixed(7) + " " + symbol.split("/")[1],
  });
  const emptyLogger = consoleLogger();
  const indicators: Indicators = calculateIndicators(symbol, candlesticks, symbolOptions, logger);
  const orderBook = undefined;
  const isFinalCandle = Boolean(latestCandle.isFinal);
  const [profit, direction] = await tradeDirection(
    emptyLogger,
    symbol,
    orderBook,
    candlesticks,
    indicators,
    exchangeOptions,
    symbolOptions,
    filter,
    isFinalCandle
  );
  const symbolTrades = exchangeOptions.tradeHistory?.[symbolKey];
  const hasTradeHistoryFlag = hasTradeHistory(symbolTrades);
  const hasOpenPositionFlag = hasOpenAlgorithmicPosition(symbolTrades, symbolKey);
  if (
    !mayExecuteAlgorithmicTrade(profit, direction, {
      hasTradeHistory: hasTradeHistoryFlag,
      hasOpenPosition: hasOpenPositionFlag,
      symbolKey,
      symbolOptions,
    })
  ) {
    // Älä printtaa skippejä — 1v replay tuottaa satojatuhansia rivejä ja jumittaa I/O:n.
    logger.flush();
    return false;
  }
  const sellPrice = simSellPriceFromCandle(latestCandle);
  const buyPrice = simBuyPriceFromCandle(latestCandle);
  let traded = false;
  if (direction === "SELL") {
    const baseSymbol = symbol.split("/")[0];
    const baseBal = tradableBalance(balances[baseSymbol]);
    const partialQty = resolvePartialTakeProfitBaseQty(baseBal, symbolOptions, profit, "SELL");
    const sellQty = partialQty ?? simSellBaseQuantity(baseBal);
    traded =
      (await simulateSell(
        symbol,
        sellQty,
        sellPrice,
        balances,
        profit,
        processOptions,
        exchangeOptions,
        symbolOptions,
        latestCandle.time,
        filter,
        logger
      )) === true;
    if (traded && partialQty != null) {
      noteTakeProfitFillOutcome(symbolOptions, profit, "SELL", true);
    }
  } else if (direction === "BUY") {
    const quoteSymbol = symbol.split("/")[1];
    const baseSymbol = symbol.split("/")[0];
    const quoteBal = tradableBalance(balances[quoteSymbol]);
    const baseBal = tradableBalance(balances[baseSymbol]);
    const partialBase = resolvePartialTakeProfitBaseQty(baseBal, symbolOptions, profit, "BUY");
    const buyQuote =
      partialBase != null && buyPrice > 0 ? partialBase * buyPrice : quoteBal;
    traded =
      (await simulateBuy(
        symbol,
        buyQuote,
        buyPrice,
        balances,
        profit,
        processOptions,
        exchangeOptions,
        symbolOptions,
        latestCandle.time,
        filter,
        logger
      )) === true;
    if (traded && partialBase != null) {
      noteTakeProfitFillOutcome(symbolOptions, profit, "BUY", true);
    }
  }
  logger.push("TrendMode", symbolOptions.trend?.current);
  logger.push("MinSell", symbolOptions.profit?.minimumSell);
  logger.push("MinBuy", symbolOptions.profit?.minimumBuy);
  if (traded) {
    logger.print();
  }
  logger.flush();
  return traded;
};
