/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/**
 * Extreme: agressiivinen quote-ping-pong (ylös ja alas).
 * - Kiinteät EUR-rajat skaalautuvat volatiliteetilla
 * - Trendi helpottaa myyntiä nousussa ja ostoa laskussa
 * - Ei stop lossia oletuksena
 * - "Jumissa" positiossa/käteisessä: lieventää rajoja odotuksen jälkeen
 * - Ei kauppoja X päivään → pakottaa seuraavan askeleen (FORCE_IDLE)
 */

import { Client } from "discord.js";
import type { Candlestick } from "../Exchanges/Candlesticks";
import { Candlesticks } from "../Exchanges/Candlesticks";
import { Exchange } from "../Exchanges/Exchange";
import { Filter } from "../Exchanges/Filters";
import { Orderbook } from "../Exchanges/Orderbook";
import { Balances } from "../Exchanges/Balances";
import {
  buy,
  calculateROI,
  getTradeHistory,
  sell,
  simulateBuy,
  simulateSell,
} from "../Exchanges/Trades";
import { simOrderbookFromCandle, simulationTimeframesForSymbol } from "../Simulation/simModeHelpers";
import { simPriceFromCandle, simSellBaseQuantity } from "../Trading/executionSizing";
import { ConfigOptions, ExchangeOptions, getMinutesFromInterval, SymbolOptions, toSymbolKey } from "../Utilities/Args";
import { ConsoleLogger, consoleLogger } from "../Utilities/ConsoleLogger";
import { symbolFilters } from "../symbolFiltersStore";
import {
  estimateQuoteFee,
  quoteEdgeForRebuy,
  quotePnlLong,
} from "./HiLowFixed";

export type ExtremeConfig = {
  sellProfitQuote: number;
  buyMoveQuote: number;
  stopLossQuote?: number;
  volatilityScale: boolean;
  volatilityLookback: number;
  trendAdjust: boolean;
  /** Kynttilöitä käteisenä ilman ostoa → ostoraja puolitetaan. */
  maxCashCandles: number;
  /** Kynttilöitä longina ilman myyntiä → myyntiraja * 0.75. */
  maxLongCandles: number;
  /** Päivää ilman uutta kauppaa → pakota myynti/osto. 0 = pois. */
  idleForceDays: number;
  /** Ylikirjoittaa idleForceDays (kynttilöitä). */
  idleForceCandles?: number;
};

export type ExtremeResolvedThresholds = {
  sellProfitQuote: number;
  buyMoveQuote: number;
  stopLossQuote?: number;
  volMult: number;
  trendSellMult: number;
  trendBuyMult: number;
  /** 0–1: kuinka pitkällä escape→idle-välillä (1 = juuri ennen pakotusta). */
  waitProgress: number;
  escapeActive: boolean;
  idleForceCandles: number | null;
  candlesSinceLastTrade: number;
};

const TRADE_TAGS = new Set(["TAKE_PROFIT", "STOP_LOSS", "FORCE_IDLE"]);

export const defaultExtremeConfig = (): ExtremeConfig => ({
  sellProfitQuote: 4,
  buyMoveQuote: 6,
  volatilityScale: true,
  volatilityLookback: 48,
  trendAdjust: true,
  maxCashCandles: 288,
  maxLongCandles: 192,
  idleForceDays: 5,
});

export const resolveExtremeConfig = (symbolOptions: SymbolOptions): ExtremeConfig => {
  const raw = symbolOptions.extreme;
  const sell = Number(raw?.sellProfitQuote);
  const buy = Number(raw?.buyMoveQuote);
  const sl = raw?.stopLossQuote != null ? Number(raw.stopLossQuote) : undefined;
  const lookback = Number(raw?.volatilityLookback);
  const maxCash = Number(raw?.maxCashCandles);
  const maxLong = Number(raw?.maxLongCandles);
  const idleDays = Number(raw?.idleForceDays);
  const idleCandlesRaw = raw?.idleForceCandles != null ? Number(raw.idleForceCandles) : undefined;
  const def = defaultExtremeConfig();
  return {
    sellProfitQuote: Number.isFinite(sell) && sell > 0 ? sell : def.sellProfitQuote,
    buyMoveQuote: Number.isFinite(buy) && buy > 0 ? buy : def.buyMoveQuote,
    volatilityScale: raw?.volatilityScale !== false,
    volatilityLookback: Number.isFinite(lookback) && lookback >= 8 ? Math.floor(lookback) : def.volatilityLookback,
    trendAdjust: raw?.trendAdjust !== false,
    maxCashCandles: Number.isFinite(maxCash) && maxCash > 0 ? Math.floor(maxCash) : def.maxCashCandles,
    maxLongCandles: Number.isFinite(maxLong) && maxLong > 0 ? Math.floor(maxLong) : def.maxLongCandles,
    idleForceDays: Number.isFinite(idleDays) && idleDays >= 0 ? idleDays : def.idleForceDays,
    ...(idleCandlesRaw != null && Number.isFinite(idleCandlesRaw) && idleCandlesRaw > 0
      ? { idleForceCandles: Math.floor(idleCandlesRaw) }
      : {}),
    ...(sl != null && Number.isFinite(sl) && sl > 0 ? { stopLossQuote: sl } : {}),
  };
};

/** Kynttilöitä ilman uutta kauppaa ennen pakotusta. null = pois käytöstä. */
export const resolveIdleForceCandles = (cfg: ExtremeConfig, intervalMinutes: number): number | null => {
  if (cfg.idleForceCandles != null && cfg.idleForceCandles > 0) {
    return cfg.idleForceCandles;
  }
  if (!Number.isFinite(cfg.idleForceDays) || cfg.idleForceDays <= 0) {
    return null;
  }
  const mins = intervalMinutes > 0 ? intervalMinutes : 5;
  return Math.max(1, Math.floor((cfg.idleForceDays * 24 * 60) / mins));
};

const bestBid = (orderBook: Orderbook): number => {
  const bids = Object.keys(orderBook.bids ?? {})
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p));
  return bids.length > 0 ? Math.max(...bids) : 0;
};

const bestAsk = (orderBook: Orderbook): number => {
  const asks = Object.keys(orderBook.asks ?? {})
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p));
  return asks.length > 0 ? Math.min(...asks) : 0;
};

/** Keskimääräinen kynttilän range-% → kerroin 0.65–1.85. */
export const volatilityMultiplierFromSeries = (
  series: Candlestick[],
  lookback: number
): number => {
  const finals = series.filter((c) => c.isFinal).slice(-lookback);
  if (finals.length < 8) return 1;
  let sum = 0;
  let n = 0;
  for (const c of finals) {
    const h = Number(c.high);
    const l = Number(c.low);
    const cl = Number(c.close);
    if (h > l && cl > 0) {
      sum += (h - l) / cl;
      n += 1;
    }
  }
  if (n === 0) return 1;
  const avgRangePct = sum / n;
  const mult = 1 + avgRangePct * 40;
  return Math.min(1.85, Math.max(0.65, mult));
};

const sma = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
};

/** Yksinkertainen trendi historiasta (SMA short vs long). */
export const inferTrendFromSeries = (
  series: Candlestick[],
  shortLen: number,
  longLen: number
): "LONG" | "SHORT" | "NEUTRAL" => {
  const finals = series.filter((c) => c.isFinal);
  const longN = Math.max(shortLen, longLen, 2);
  if (finals.length < longN) return "NEUTRAL";
  const closes = finals.slice(-longN).map((c) => Number(c.close)).filter((p) => p > 0);
  if (closes.length < longN) return "NEUTRAL";
  const s = sma(closes.slice(-shortLen));
  const l = sma(closes.slice(-longLen));
  if (s > l * 1.001) return "LONG";
  if (s < l * 0.999) return "SHORT";
  return "NEUTRAL";
};

export const trendThresholdMultipliers = (
  trend: "LONG" | "SHORT" | "NEUTRAL",
  lastTradeIsBuyer: boolean
): { sellMult: number; buyMult: number } => {
  if (trend === "LONG") {
    return lastTradeIsBuyer ? { sellMult: 0.88, buyMult: 1 } : { sellMult: 1, buyMult: 1.12 };
  }
  if (trend === "SHORT") {
    return lastTradeIsBuyer ? { sellMult: 1.08, buyMult: 1 } : { sellMult: 1, buyMult: 0.88 };
  }
  return { sellMult: 1, buyMult: 1 };
};

export const candlesSinceTrade = (
  tradeTimeMs: number,
  latestCandleTimeMs: number,
  intervalMinutes: number
): number => {
  if (!(tradeTimeMs > 0 && latestCandleTimeMs >= tradeTimeMs && intervalMinutes > 0)) return 0;
  const step = intervalMinutes * 60 * 1000;
  return Math.floor((latestCandleTimeMs - tradeTimeMs) / step);
};

/**
 * Max odotus: kiristää rajoja progressiivisesti escape-kynnyksestä kohti idle-pakotusta.
 * Vanha bugi: yksi 0.5×/0.75× askel → jumittui siihen kunnes FORCE_IDLE (päivien kuollut vyöhyke).
 */
export const computeWaitEaseFactors = (
  waited: number,
  lastTradeIsBuyer: boolean,
  maxLongCandles: number,
  maxCashCandles: number,
  idleForceCandles: number | null
): { sellFactor: number; buyFactor: number; waitProgress: number; escapeActive: boolean } => {
  const escapeAt = lastTradeIsBuyer ? maxLongCandles : maxCashCandles;
  if (waited < escapeAt) {
    return { sellFactor: 1, buyFactor: 1, waitProgress: 0, escapeActive: false };
  }
  const idleEnd =
    idleForceCandles != null && idleForceCandles > escapeAt ? idleForceCandles : escapeAt + Math.max(escapeAt, 96);
  const span = Math.max(1, idleEnd - escapeAt);
  const progress = Math.min(1, (waited - escapeAt) / span);
  const startSell = 0.75;
  const startBuy = 0.5;
  const floor = 0.05;
  let sellFactor = 1;
  let buyFactor = 1;
  if (lastTradeIsBuyer) {
    sellFactor = startSell - progress * (startSell - floor);
  } else {
    buyFactor = startBuy - progress * (startBuy - floor);
  }
  return { sellFactor, buyFactor, waitProgress: progress, escapeActive: true };
};

export const resolveExtremeThresholds = (
  cfg: ExtremeConfig,
  opts: {
    series: Candlestick[];
    symbolOptions: SymbolOptions;
    lastTradeIsBuyer: boolean;
    lastTradeTimeMs: number;
    latestCandleTimeMs: number;
    primaryTf: string;
  }
): ExtremeResolvedThresholds => {
  let volMult = 1;
  if (cfg.volatilityScale) {
    volMult = volatilityMultiplierFromSeries(opts.series, cfg.volatilityLookback);
  }

  let trendSellMult = 1;
  let trendBuyMult = 1;
  if (cfg.trendAdjust) {
    const fromConfig = opts.symbolOptions.trend?.current?.toUpperCase();
    let trend: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    if (fromConfig === "LONG" || fromConfig === "SHORT") {
      trend = fromConfig;
    } else if (opts.symbolOptions.trend?.enabled) {
      const ema = opts.symbolOptions.trend.ema;
      trend = inferTrendFromSeries(opts.series, ema?.short ?? 9, ema?.long ?? 21);
    }
    const t = trendThresholdMultipliers(trend, opts.lastTradeIsBuyer);
    trendSellMult = t.sellMult;
    trendBuyMult = t.buyMult;
  }

  const intervalMin = getMinutesFromInterval(opts.primaryTf as Parameters<typeof getMinutesFromInterval>[0]);
  const waited = candlesSinceTrade(opts.lastTradeTimeMs, opts.latestCandleTimeMs, intervalMin);
  const idleForceCandles = resolveIdleForceCandles(cfg, intervalMin);
  const waitEase = computeWaitEaseFactors(
    waited,
    opts.lastTradeIsBuyer,
    cfg.maxLongCandles,
    cfg.maxCashCandles,
    idleForceCandles
  );

  let sellProfitQuote = cfg.sellProfitQuote * volMult * trendSellMult;
  let buyMoveQuote = cfg.buyMoveQuote * volMult * trendBuyMult;
  sellProfitQuote *= waitEase.sellFactor;
  buyMoveQuote *= waitEase.buyFactor;

  return {
    sellProfitQuote,
    buyMoveQuote,
    stopLossQuote: cfg.stopLossQuote,
    volMult,
    trendSellMult,
    trendBuyMult,
    waitProgress: waitEase.waitProgress,
    escapeActive: waitEase.escapeActive,
    idleForceCandles,
    candlesSinceLastTrade: waited,
  };
};

export type ExtremeSignal = "HOLD" | "TAKE_PROFIT" | "STOP_LOSS" | "FORCE_IDLE";

/** Jos normaali signaali on HOLD ja viimeisestä kaupasta ≥ idleForceCandles → pakota. */
export const applyIdleForceSignal = (
  signal: ExtremeSignal,
  thresholds: ExtremeResolvedThresholds
): ExtremeSignal => {
  if (signal !== "HOLD") return signal;
  const limit = thresholds.idleForceCandles;
  if (limit == null || limit <= 0) return signal;
  if (thresholds.candlesSinceLastTrade >= limit) {
    return "FORCE_IDLE";
  }
  return signal;
};

export const evaluateExtremeSignal = (
  lastTradeIsBuyer: boolean,
  entryPrice: number,
  baseQty: number,
  orderBook: Orderbook,
  feePct: number,
  thresholds: ExtremeResolvedThresholds
): ExtremeSignal => {
  if (lastTradeIsBuyer) {
    const pnl = quotePnlLong(entryPrice, baseQty, bestBid(orderBook), feePct);
    if (thresholds.stopLossQuote != null && pnl <= -thresholds.stopLossQuote) {
      return "STOP_LOSS";
    }
    if (pnl >= thresholds.sellProfitQuote) {
      return "TAKE_PROFIT";
    }
    return "HOLD";
  }
  const edge = quoteEdgeForRebuy(entryPrice, baseQty, bestAsk(orderBook), feePct);
  if (thresholds.stopLossQuote != null && edge <= -thresholds.stopLossQuote) {
    return "STOP_LOSS";
  }
  if (edge >= thresholds.buyMoveQuote) {
    return "TAKE_PROFIT";
  }
  return "HOLD";
};

const runExtremeTrade = async (
  symbol: string,
  check: ExtremeSignal,
  lastTradeIsBuyer: boolean,
  price: number,
  balances: Balances,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  time: number,
  filter: Filter,
  logger: ConsoleLogger,
  live?: { discord: Client; exchange: Exchange; orderBook: Orderbook }
): Promise<void> => {
  if (!TRADE_TAGS.has(check)) return;
  const tag = check;
  if (lastTradeIsBuyer) {
    const baseSymbol = symbol.split("/")[0]!;
    const qty = simSellBaseQuantity(balances[baseSymbol]?.crypto ?? 0);
    if (live) {
      await sell(
        live.discord,
        live.exchange,
        logger,
        symbol,
        tag,
        live.orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        undefined
      );
    } else {
      await simulateSell(symbol, qty, price, balances, tag, processOptions, exchangeOptions, symbolOptions, time, filter, logger);
    }
  } else {
    const quoteSymbol = symbol.split("/")[1]!;
    const quoteAmt = balances[quoteSymbol]?.crypto ?? 0;
    if (live) {
      await buy(
        live.discord,
        live.exchange,
        logger,
        symbol,
        tag,
        live.orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        undefined
      );
    } else {
      await simulateBuy(symbol, quoteAmt, price, balances, tag, processOptions, exchangeOptions, symbolOptions, time, filter, logger);
    }
  }
};

export const simulateExtreme = async (
  symbol: string,
  candlesticks: Candlesticks,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  balances: Balances,
  filter: Filter
): Promise<boolean> => {
  if (symbolOptions.enabled === false) return false;
  const symbolKey = toSymbolKey(symbol);
  const primaryTf = simulationTimeframesForSymbol(symbolOptions)[0]!;
  const series = candlesticks[symbolKey]?.[primaryTf];
  if (!Array.isArray(series) || series.length < 1) return false;

  const latestCandle = series[series.length - 1]!;
  if (!latestCandle.isFinal) return false;

  exchangeOptions.tradeHistory = exchangeOptions.tradeHistory ?? {};
  if (!Array.isArray(exchangeOptions.tradeHistory[symbolKey])) {
    exchangeOptions.tradeHistory[symbolKey] = [];
  }
  exchangeOptions.orderbooks = exchangeOptions.orderbooks ?? {};
  const orderBook = simOrderbookFromCandle(latestCandle);
  exchangeOptions.orderbooks[symbolKey] = orderBook;

  const tradeHistory = exchangeOptions.tradeHistory[symbolKey]!;
  const price = simPriceFromCandle(latestCandle);
  const logger = consoleLogger();
  const cfg = resolveExtremeConfig(symbolOptions);
  const feePct = symbolOptions.tradeFeePercentage ?? 0;

  if (tradeHistory.length === 0) {
    const quoteSymbol = symbol.split("/")[1]!;
    await simulateBuy(
      symbol,
      balances[quoteSymbol]?.crypto ?? 0,
      price,
      balances,
      "SKIP",
      processOptions,
      exchangeOptions,
      symbolOptions,
      latestCandle.time,
      filter,
      logger
    );
    return true;
  }

  const lastTrade = tradeHistory[tradeHistory.length - 1]!;
  const entryPrice = parseFloat(lastTrade.price);
  const baseQty = parseFloat(lastTrade.qty);
  const thresholds = resolveExtremeThresholds(cfg, {
    series,
    symbolOptions,
    lastTradeIsBuyer: lastTrade.isBuyer,
    lastTradeTimeMs: lastTrade.time,
    latestCandleTimeMs: latestCandle.time,
    primaryTf,
  });
  let check = evaluateExtremeSignal(lastTrade.isBuyer, entryPrice, baseQty, orderBook, feePct, thresholds);
  check = applyIdleForceSignal(check, thresholds);

  logger.push("Extreme", {
    ...thresholds,
    lastIsBuyer: lastTrade.isBuyer,
    quotePnl: lastTrade.isBuyer
      ? quotePnlLong(entryPrice, baseQty, bestBid(orderBook), feePct)
      : quoteEdgeForRebuy(entryPrice, baseQty, bestAsk(orderBook), feePct),
    signal: check,
  });

  await runExtremeTrade(
    symbol,
    check,
    lastTrade.isBuyer,
    price,
    balances,
    processOptions,
    exchangeOptions,
    symbolOptions,
    latestCandle.time,
    filter,
    logger
  );
  if (TRADE_TAGS.has(check)) {
    logger.print();
    logger.flush();
  }
  return true;
};

export const extreme = async (
  discord: Client,
  exchange: Exchange,
  log: ConsoleLogger,
  symbol: string,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
): Promise<boolean> => {
  const filter = symbolFilters[toSymbolKey(symbol)];
  const symbolKey = toSymbolKey(symbol);
  if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
    exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbol);
  }
  const tradeHistory = exchangeOptions.tradeHistory[symbolKey];
  const lastTrade = tradeHistory[tradeHistory.length - 1];
  log.push("Symbol", symbolKey);
  const roi = calculateROI(exchangeOptions.tradeHistory[symbolKey]);
  log.push("Profit in Base", roi[0].toFixed(7) + " " + symbol.split("/")[0]);
  log.push("Profit in Quote", roi[1].toFixed(7) + " " + symbol.split("/")[1]);

  const orderBook = exchangeOptions.orderbooks[symbolKey];
  if (
    orderBook === undefined ||
    !orderBook.bids ||
    !orderBook.asks ||
    Object.keys(orderBook.bids).length === 0 ||
    Object.keys(orderBook.asks).length === 0
  ) {
    log.push("error", "Orderbook not ready for extreme");
    log.print();
    log.flush();
    return false;
  }
  if (lastTrade === undefined) {
    console.log(`Do a manual trade on symbol ${symbol}`);
    return false;
  }

  const cfg = resolveExtremeConfig(symbolOptions);
  const feePct = symbolOptions.tradeFeePercentage ?? 0;
  const entryPrice = parseFloat(lastTrade.price);
  const baseQty = parseFloat(lastTrade.qty);
  const primaryTf = simulationTimeframesForSymbol(symbolOptions)[0]!;
  const thresholds = resolveExtremeThresholds(cfg, {
    series: [],
    symbolOptions,
    lastTradeIsBuyer: lastTrade.isBuyer,
    lastTradeTimeMs: lastTrade.time,
    latestCandleTimeMs: Date.now(),
    primaryTf,
  });
  let check = evaluateExtremeSignal(lastTrade.isBuyer, entryPrice, baseQty, orderBook, feePct, thresholds);
  check = applyIdleForceSignal(check, thresholds);

  log.push("Extreme", { ...thresholds, signal: check });

  if (TRADE_TAGS.has(check)) {
    await runExtremeTrade(
      symbol,
      check,
      lastTrade.isBuyer,
      bestBid(orderBook),
      exchangeOptions.balances!,
      processOptions,
      exchangeOptions,
      symbolOptions,
      Date.now(),
      filter,
      log,
      { discord, exchange, orderBook }
    );
  }

  log.print();
  log.flush();
  return true;
};
