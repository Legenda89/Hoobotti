/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import { Client } from "discord.js";
import { symbolFilters } from "../symbolFiltersStore";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { ConfigOptions, ExchangeOptions, SymbolOptions, toSymbolKey } from "../Utilities/Args";
import { Balances } from "../Exchanges/Balances";
import {
  buy,
  calculateROI,
  getTradeHistory,
  sell,
  simulateBuy,
  simulateSell,
} from "../Exchanges/Trades";
import { Exchange } from "../Exchanges/Exchange";
import { Orderbook } from "../Exchanges/Orderbook";
import { Candlesticks } from "../Exchanges/Candlesticks";
import { Filter } from "../Exchanges/Filters";
import { simOrderbookFromCandle, simulationTimeframesForSymbol } from "../Simulation/simModeHelpers";
import { simPriceFromCandle, simSellBaseQuantity } from "../Trading/executionSizing";
import { consoleLogger } from "../Utilities/ConsoleLogger";

export type HilowFixedConfig = {
  /** Myy long, kun quote-voitto (bid vs entry) ≥ tämä. */
  sellProfitQuote: number;
  /** Osta uudelleen myynnin jälkeen, kun suotuisa liike (myyntihinta vs ask) ≥ tämä quote-EUR. */
  buyMoveQuote: number;
  /** Valinnainen: myy/stop long kun quote-tappio ≥ tämä (positiivinen luku, esim. 3 = −3 EUR). */
  stopLossQuote?: number;
};

const HILOW_FIXED_TRADE_TAGS = new Set(["TAKE_PROFIT", "STOP_LOSS"]);

export const defaultHilowFixedConfig = (): HilowFixedConfig => ({
  sellProfitQuote: 5,
  buyMoveQuote: 7,
});

export const resolveHilowFixedConfig = (symbolOptions: SymbolOptions): HilowFixedConfig => {
  const raw = symbolOptions.hilowFixed;
  const sellProfitQuote = Number(raw?.sellProfitQuote);
  const buyMoveQuote = Number(raw?.buyMoveQuote);
  const stopLossQuote = raw?.stopLossQuote != null ? Number(raw.stopLossQuote) : undefined;
  return {
    sellProfitQuote: Number.isFinite(sellProfitQuote) && sellProfitQuote > 0 ? sellProfitQuote : 5,
    buyMoveQuote: Number.isFinite(buyMoveQuote) && buyMoveQuote > 0 ? buyMoveQuote : 7,
    ...(stopLossQuote != null && Number.isFinite(stopLossQuote) && stopLossQuote > 0
      ? { stopLossQuote }
      : {}),
  };
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

/** Arvioitu fee quote-valuutassa yhdestä suunnasta (osto tai myynti). */
export const estimateQuoteFee = (notionalQuote: number, feePct: number): number => {
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0 || feePct <= 0) return 0;
  return (notionalQuote * feePct) / 100;
};

/** Long-positio: quote-voitto ennen seuraavaa myyntiä. */
export const quotePnlLong = (
  entryPrice: number,
  baseQty: number,
  exitBid: number,
  feePct: number
): number => {
  if (!(entryPrice > 0 && baseQty > 0 && exitBid > 0)) return 0;
  const gross = (exitBid - entryPrice) * baseQty;
  const fees = estimateQuoteFee(entryPrice * baseQty, feePct) + estimateQuoteFee(exitBid * baseQty, feePct);
  return gross - fees;
};

/** Myynnin jälkeen: kuinka paljon quotea "voitettu" halvemmalla ostohinnalla (sama base-määrä). */
export const quoteEdgeForRebuy = (
  sellPrice: number,
  baseQty: number,
  ask: number,
  feePct: number
): number => {
  if (!(sellPrice > 0 && baseQty > 0 && ask > 0)) return 0;
  const gross = (sellPrice - ask) * baseQty;
  const fees = estimateQuoteFee(sellPrice * baseQty, feePct) + estimateQuoteFee(ask * baseQty, feePct);
  return gross - fees;
};

export type HilowFixedSignal = "HOLD" | "TAKE_PROFIT" | "STOP_LOSS";

export const evaluateHilowFixedSignal = (
  lastTradeIsBuyer: boolean,
  entryPrice: number,
  baseQty: number,
  orderBook: Orderbook,
  feePct: number,
  cfg: HilowFixedConfig
): HilowFixedSignal => {
  if (lastTradeIsBuyer) {
    const bid = bestBid(orderBook);
    const pnl = quotePnlLong(entryPrice, baseQty, bid, feePct);
    if (cfg.stopLossQuote != null && pnl <= -cfg.stopLossQuote) {
      return "STOP_LOSS";
    }
    if (pnl >= cfg.sellProfitQuote) {
      return "TAKE_PROFIT";
    }
    return "HOLD";
  }
  const ask = bestAsk(orderBook);
  const edge = quoteEdgeForRebuy(entryPrice, baseQty, ask, feePct);
  if (cfg.stopLossQuote != null && edge <= -cfg.stopLossQuote) {
    return "STOP_LOSS";
  }
  if (edge >= cfg.buyMoveQuote) {
    return "TAKE_PROFIT";
  }
  return "HOLD";
};

const runHilowFixedTrade = async (
  symbol: string,
  check: HilowFixedSignal,
  lastTradeIsBuyer: boolean,
  price: number,
  balances: Balances,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  time: number,
  filter: Filter,
  logger: ConsoleLogger,
  live?: {
    discord: Client;
    exchange: Exchange;
    orderBook: Orderbook;
  }
): Promise<void> => {
  if (!HILOW_FIXED_TRADE_TAGS.has(check)) return;
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

export const simulateHilowFixed = async (
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
  const cfg = resolveHilowFixedConfig(symbolOptions);
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
  const check = evaluateHilowFixedSignal(lastTrade.isBuyer, entryPrice, baseQty, orderBook, feePct, cfg);

  logger.push("HiLowFixed", {
    sellProfitQuote: cfg.sellProfitQuote,
    buyMoveQuote: cfg.buyMoveQuote,
    lastIsBuyer: lastTrade.isBuyer,
    quotePnl: lastTrade.isBuyer
      ? quotePnlLong(entryPrice, baseQty, bestBid(orderBook), feePct)
      : quoteEdgeForRebuy(entryPrice, baseQty, bestAsk(orderBook), feePct),
    signal: check,
  });

  await runHilowFixedTrade(
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
  if (HILOW_FIXED_TRADE_TAGS.has(check)) {
    logger.print();
    logger.flush();
  }
  return true;
};

export const hilowFixed = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const filter = symbolFilters[toSymbolKey(symbol)];
  const symbolKey = toSymbolKey(symbol);
  if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
    exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbol);
  }
  const tradeHistory = exchangeOptions.tradeHistory[symbolKey];
  const lastTrade = tradeHistory[tradeHistory.length - 1];
  consoleLogger.push("Symbol", symbolKey);
  const roi = calculateROI(exchangeOptions.tradeHistory[symbolKey]);
  consoleLogger.push("Profit in Base", roi[0].toFixed(7) + " " + symbol.split("/")[0]);
  consoleLogger.push("Profit in Quote", roi[1].toFixed(7) + " " + symbol.split("/")[1]);
  const orderBook = exchangeOptions.orderbooks[symbolKey];
  if (
    orderBook === undefined ||
    orderBook.bids === undefined ||
    orderBook.asks === undefined ||
    Object.keys(orderBook.bids).length === 0 ||
    Object.keys(orderBook.asks).length === 0
  ) {
    consoleLogger.push("error", "Orderbook not ready for hilow_fixed");
    consoleLogger.print();
    consoleLogger.flush();
    return false;
  }
  if (lastTrade === undefined) {
    console.log(`Do a manual trade on symbol ${symbol}`);
    return false;
  }

  const cfg = resolveHilowFixedConfig(symbolOptions);
  const feePct = symbolOptions.tradeFeePercentage ?? 0;
  const entryPrice = parseFloat(lastTrade.price);
  const baseQty = parseFloat(lastTrade.qty);
  const check = evaluateHilowFixedSignal(lastTrade.isBuyer, entryPrice, baseQty, orderBook, feePct, cfg);

  consoleLogger.push("HiLowFixed", {
    sellProfitQuote: cfg.sellProfitQuote,
    buyMoveQuote: cfg.buyMoveQuote,
    signal: check,
  });

  if (HILOW_FIXED_TRADE_TAGS.has(check)) {
    await runHilowFixedTrade(
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
      consoleLogger,
      { discord, exchange, orderBook }
    );
  }

  consoleLogger.print();
  consoleLogger.flush();
  return true;
};
