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
import { symbolFilters } from "../symbolFiltersStore";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { ConfigOptions, ExchangeOptions, SymbolOptions, toSymbolKey } from "../Utilities/Args";
import { Balances } from "../Exchanges/Balances";
import { buy, sell, simulateBuy, simulateSell } from "../Exchanges/Trades";
import { Exchange } from "../Exchanges/Exchange";
import { logToFile } from "../Utilities/LogToFile";
import { Candlesticks } from "../Exchanges/Candlesticks";
import { Filter } from "../Exchanges/Filters";
import { simOrderbookFromCandle, simulationTimeframesForSymbol } from "../Simulation/simModeHelpers";
import { simPriceFromCandle, simSellBaseQuantity } from "../Trading/executionSizing";
import { consoleLogger } from "../Utilities/ConsoleLogger";

export const simulatePeriodic = async (
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

  const currentTime = latestCandle.time;
  const lastTradeTime = symbolOptions.periodicTime || 0;
  const intervalMilliseconds = (symbolOptions.periodicInterval ?? 0) * 1000;
  if (intervalMilliseconds <= 0 || currentTime - lastTradeTime < intervalMilliseconds) {
    return false;
  }
  symbolOptions.periodicTime = currentTime;

  exchangeOptions.orderbooks = exchangeOptions.orderbooks ?? {};
  exchangeOptions.orderbooks[symbolKey] = simOrderbookFromCandle(latestCandle);
  const price = simPriceFromCandle(latestCandle);
  const logger = consoleLogger();
  const qty = symbolOptions.periodicQuantity ?? 0;

  if (symbolOptions.periodicDirection) {
    await simulateBuy(
      symbol,
      qty > 0 ? qty * price : balances[symbol.split("/")[1]!]?.crypto ?? 0,
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
  } else {
    await simulateSell(
      symbol,
      qty > 0 ? qty : simSellBaseQuantity(balances[symbol.split("/")[0]!]?.crypto ?? 0),
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
  }
  return true;
};

export const periodic = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const currentTime = Date.now();
  const lastTradeTime = symbolOptions.periodicTime || 0;
  const timeSinceLastTrade = currentTime - lastTradeTime;
  const intervalMilliseconds = symbolOptions.periodicInterval * 1000;
  if (timeSinceLastTrade >= intervalMilliseconds) {
    symbolOptions.periodicTime = currentTime;
    const orderBook = exchangeOptions.orderbooks[toSymbolKey(symbol)];
    const filter = symbolFilters[toSymbolKey(symbol)];
    if (symbolOptions.periodicDirection) {
      consoleLogger.push("Performing periodic BUY", `Buying ${symbolOptions.periodicQuantity} of ${symbol}`);
      await buy(
        discord,
        exchange,
        consoleLogger,
        symbol,
        "SKIP",
        orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        symbolOptions.periodicQuantity
      );
    } else {
      consoleLogger.push("Performing periodic SELL", `Selling ${symbolOptions.periodicQuantity} of ${symbol}`);
      await sell(
        discord,
        exchange,
        consoleLogger,
        symbol,
        "SKIP",
        orderBook,
        filter,
        processOptions,
        exchangeOptions,
        symbolOptions,
        symbolOptions.periodicQuantity
      );
    }
    consoleLogger.print();
    consoleLogger.flush();
  }
  return true;
};
