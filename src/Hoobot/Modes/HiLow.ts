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
import { checkProfitSignals } from "../Indicators/Profit";
import { Candlesticks } from "../Exchanges/Candlesticks";
import { Filter } from "../Exchanges/Filters";
import { simOrderbookFromCandle, simulationTimeframesForSymbol } from "../Simulation/simModeHelpers";
import { simPriceFromCandle, simSellBaseQuantity } from "../Trading/executionSizing";
import { consoleLogger } from "../Utilities/ConsoleLogger";

const HILOW_TRADE_SIGNALS = new Set(["TAKE_PROFIT", "TAKE_PROFIT_FORCE", "STOP_LOSS"]);

export const simulateHilow = async (
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
  const next = lastTrade.isBuyer ? "SELL" : "BUY";
  const trend = symbolOptions.trend?.current ?? "LONG";
  const check = await checkProfitSignals(
    logger,
    next,
    trend,
    orderBook,
    latestCandle.time,
    exchangeOptions,
    symbolOptions,
    true
  );

  if (!HILOW_TRADE_SIGNALS.has(check)) {
    return true;
  }

  if (lastTrade.isBuyer) {
    const baseSymbol = symbol.split("/")[0]!;
    await simulateSell(
      symbol,
      simSellBaseQuantity(balances[baseSymbol]?.crypto ?? 0),
      price,
      balances,
      check,
      processOptions,
      exchangeOptions,
      symbolOptions,
      latestCandle.time,
      filter,
      logger
    );
  } else {
    const quoteSymbol = symbol.split("/")[1]!;
    await simulateBuy(
      symbol,
      balances[quoteSymbol]?.crypto ?? 0,
      price,
      balances,
      check,
      processOptions,
      exchangeOptions,
      symbolOptions,
      latestCandle.time,
      filter,
      logger
    );
  }
  return true;
};

export const hilow = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const filter = symbolFilters[toSymbolKey(symbol)];
  if (exchangeOptions.tradeHistory[toSymbolKey(symbol)] === undefined) {
    exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
  }
  const tradeHistory = exchangeOptions.tradeHistory[toSymbolKey(symbol)];
  const lastTrade = tradeHistory[tradeHistory.length - 1];
  consoleLogger.push("Symbol", toSymbolKey(symbol));
  const roi = calculateROI(exchangeOptions.tradeHistory[toSymbolKey(symbol)]);
  consoleLogger.push("Profit in Base", roi[0].toFixed(7) + " " + symbol.split("/")[0]);
  consoleLogger.push("Profit in Quote", roi[1].toFixed(7) + " " + symbol.split("/")[1]);
  if (symbolOptions.growingMax?.buy! > 0) {
    consoleLogger.push("Max buy amount", symbolOptions.growingMax?.buy + " " + symbol.split("/")[1]);
  }
  const orderBook = exchangeOptions.orderbooks[toSymbolKey(symbol)];
  if (
    orderBook === undefined ||
    orderBook.bids === undefined ||
    orderBook.asks === undefined ||
    Object.keys(orderBook.bids).length === 0 ||
    Object.keys(orderBook.asks).length === 0
  ) {
    consoleLogger.push("error", "Orderbook not ready for hilow");
    consoleLogger.print();
    consoleLogger.flush();
    return false;
  }
  if (lastTrade === undefined) {
    console.log(`Do a manual trade on symbol ${symbol}`);
    return false;
  }

  const next = lastTrade.isBuyer ? "SELL" : "BUY";
  const trend = symbolOptions.trend?.current ?? "LONG";
  const check = await checkProfitSignals(
    consoleLogger,
    next,
    trend,
    orderBook,
    Date.now(),
    exchangeOptions,
    symbolOptions,
    true
  );

  if (!HILOW_TRADE_SIGNALS.has(check)) {
    consoleLogger.print();
    consoleLogger.flush();
    return true;
  }

  if (lastTrade.isBuyer) {
    await sell(
      discord,
      exchange,
      consoleLogger,
      symbol,
      check,
      orderBook,
      filter,
      processOptions,
      exchangeOptions,
      symbolOptions,
      undefined
    );
  } else {
    await buy(
      discord,
      exchange,
      consoleLogger,
      symbol,
      check,
      orderBook,
      filter,
      processOptions,
      exchangeOptions,
      symbolOptions,
      undefined
    );
  }

  consoleLogger.print();
  consoleLogger.flush();
  return true;
};
