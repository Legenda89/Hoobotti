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
import { ConfigOptions, ExchangeOptions, GridLevel, SymbolOptions, toSymbolKey } from "../Utilities/Args";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { Candlesticks } from "../Exchanges/Candlesticks";
import {
  throttleKeyTradeHistory,
  throttleKeyBalances,
  shouldFetchData,
  markDataFetched,
} from "../Utilities/DataFetchThrottle";
import { getTradeHistory, placeBuyOrder, placeSellOrder, delay } from "../Exchanges/Trades";
import { Exchange } from "../Exchanges/Exchange";
import { logToFile } from "../Utilities/LogToFile";
import { cancelOrder, getOpenOrders, getOrder, Order } from "../Exchanges/Orders";
import { assignCurrentBalances } from "../Exchanges/Balances";
import { symbolFilters } from "../symbolFiltersStore";
import { sendMessageToChannel } from "../../Discord/discord";

const createGrid = (currentPrice: number, options: SymbolOptions): GridLevel[] => {
  const grid: GridLevel[] = [];
  const upper = currentPrice * (1 + options.gridRange.upper / 100);
  const lower = currentPrice * (1 - options.gridRange.lower / 100);
  const step = (upper - lower) / options.gridLevels;

  for (let i = 0; i < options.gridLevels; i++) {
    const price = lower + i * step;
    const type = price < currentPrice ? "buy" : "sell";
    grid.push({
      orderId: "",
      price: price,
      type: type,
      executed: false,
      size: options.gridOrderSize.toFixed(8),
    });
  }
  return grid;
};

const buildGridFromExistingOrders = (openOrders: Order[]): GridLevel[] => {
  const grid: GridLevel[] = [];
  for (const order of openOrders) {
    grid.push({
      orderId: order.orderId,
      price: parseFloat(order.price),
      type: order.isBuyer === true ? "buy" : "sell",
      executed: false,
      size: order.qty,
    });
  }
  // Sort the grid by price
  grid.sort((a, b) => a.price - b.price);
  return grid;
};

export const placeOrder = async (
  exchange: Exchange,
  symbol: string,
  direction: string,
  price: number,
  quantityInBase: number,
  exchangeOptions: ExchangeOptions
): Promise<Order> => {
  // Grid always uses limit orders — never symbol liveOrderExecution market/aggressive settings.
  const gridOrderOpts = { mode: "limit" as const };
  if (direction === "sell") {
    let order = await placeSellOrder(exchange, exchangeOptions, symbol, quantityInBase, price, 5, gridOrderOpts);
    if (order !== undefined) {
      await assignCurrentBalances(exchange, exchangeOptions);
      if (exchangeOptions.tradeHistory === undefined) {
        exchangeOptions.tradeHistory = {};
      }
      exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
      return order;
    } else {
      return {} as Order;
    }
  } else if (direction === "buy") {
    let order = await placeBuyOrder(exchange, exchangeOptions, symbol, quantityInBase, price, 5, gridOrderOpts);
    if (order !== undefined) {
      await assignCurrentBalances(exchange, exchangeOptions);
      if (exchangeOptions.tradeHistory === undefined) {
        exchangeOptions.tradeHistory = {};
      }
      exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
      return order;
    } else {
      return {} as Order;
    }
  }
  return {} as Order;
};

const placeGridOrders = async (
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  grid: GridLevel[],
  _filter: Filter,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
): Promise<void> => {
  const placedOrders = [];
  for (var i = 0; i < grid.length; i++) {
    if (!grid[i].executed) {
      try {
        const order = await placeOrder(
          exchange,
          symbol,
          grid[i].type,
          grid[i].price,
          parseFloat(grid[i].size),
          exchangeOptions
        );
        grid[i].orderId = order.orderId;
        grid[i].size = order.qty;
        placedOrders.push({
          id: grid[i].orderId,
          direction: grid[i].type,
          price: grid[i].price,
          size: symbolOptions.gridOrderSize,
        });
      } catch (error) {
        consoleLogger.push(
          `Failed to place order`,
          `Direction: ${grid[i].type}, Price: ${grid[i].price}, Error: ${error}`
        );
      }
    }
  }
  consoleLogger.push("Placed orders", placedOrders);
};

const isOutsideGridRange = (currentPrice: number, grid: GridLevel[]): boolean => {
  const lowestPrice = Math.min(...grid.map((level) => level.price));
  const highestPrice = Math.max(...grid.map((level) => level.price));
  return currentPrice < lowestPrice || currentPrice > highestPrice;
};

const rebalanceGrid = async (
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  currentPrice: number,
  filter: Filter,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
): Promise<void> => {
  const openOrders = await getOpenOrders(exchange, symbol);

  if (openOrders.length < symbolOptions.gridOrderSize * 2) {
    return;
  }
  const existingGrid = buildGridFromExistingOrders(openOrders);
  if (!isOutsideGridRange(currentPrice, existingGrid)) {
    consoleLogger.push("Rebalancing skipped", "Current price is within existing grid range");
    symbolOptions.grid = existingGrid;
    return;
  }

  if (symbolOptions.gridRebalance == false) {
    return;
  }
  // If we reach here, rebalancing is necessary
  for (const order of openOrders) {
    await cancelOrder(exchange, symbol, order.orderId);
  }
  symbolOptions.grid = createGrid(currentPrice, symbolOptions);
  await placeGridOrders(exchange, consoleLogger, symbol, symbolOptions.grid, filter, exchangeOptions, symbolOptions);
  consoleLogger.push("Grid rebalanced", `New center price: ${currentPrice}`);
};

const calculatePotentialProfit = (buyPrice: number, sellPrice: number, fees: number): number => {
  const grossProfit = (sellPrice - buyPrice) / buyPrice;
  return grossProfit - fees * 2; // Subtract fees for both buy and sell
};

const manageGridOrders = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  openOrders: Order[],
  symbol: string,
  currentPrice: number,
  grid: GridLevel[],
  _filter: Filter,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
): Promise<boolean> => {
  let orderExecuted = false;
  for (var i = 0; i < grid.length; i++) {
    if (grid[i].orderId.length > 0 && grid[i].executed == false) {
      const orderExists = openOrders.some((order) => order.orderId === grid[i].orderId);
      if (!orderExists) {
        await delay(150);
        const order = await getOrder(exchange, symbol, grid[i].orderId);
        if (order.orderStatus === "Cancelled") {
          grid[i].executed = true;
        } else if (order.orderStatus === "Filled") {
          // Order was filled
          grid[i].executed = true;
          orderExecuted = true;

          let msg = "```";
          msg += `Order executed: ${symbol}\r\n`;
          msg += `${grid[i].type.toUpperCase()} ID: ${grid[i].orderId}\r\n`;
          msg += `Price: ${grid[i].price}\r\n`;
          msg += `Qty: ${grid[i].size}\r\n`;
          msg += `Time now ${new Date().toLocaleString("fi-fi")}\r\n`;
          msg += "```";

          sendMessageToChannel(discord, processOptions.discord?.channelId, msg);
          consoleLogger.push(
            `Order executed`,
            `Type: ${grid[i].type}, Price: ${grid[i].price}, OrderID: ${grid[i].orderId}`
          );

          // Calculate new order details
          const newDirection = grid[i].type === "buy" ? "sell" : "buy";
          const upper = currentPrice * (1 + symbolOptions.gridRange.upper / 100);
          const lower = currentPrice * (1 - symbolOptions.gridRange.lower / 100);
          const step = (upper - lower) / symbolOptions.gridLevels;
          const newOrderPrice = grid[i].type === "buy" ? grid[i].price + step : grid[i].price - step;

          const fees = 0.2; // Assume 0.2% fee, adjust as needed
          const potentialProfit = calculatePotentialProfit(grid[i].price, newOrderPrice, fees);
          var minimumProfit =
            newDirection === "buy" ? symbolOptions.profit?.minimumBuy || 0 : symbolOptions.profit?.minimumSell || 0;

          if (potentialProfit >= minimumProfit / 100) {
            const newOrder = await placeOrder(
              exchange,
              symbol,
              newDirection,
              newOrderPrice,
              symbolOptions.gridOrderSize,
              exchangeOptions
            );

            // Update the grid level with new order details
            grid[i].type = newDirection;
            grid[i].price = newOrderPrice;
            grid[i].orderId = newOrder.orderId;
            grid[i].executed = false;
            grid[i].size = newOrder.qty;

            // let msg = "```";
            // msg += `Placed new order: ${symbol}\r\n`;
            // msg += `${grid[i].type.toUpperCase()} ID: ${grid[i].orderId}\r\n`;
            // msg += `Price: ${grid[i].price.toPrecision(8)}\r\n`;
            // msg += `Qty: ${grid[i].size}\r\n`;
            // msg += `Time now ${new Date().toLocaleString("fi-fi")}\r\n`;
            // msg += "```";
            // sendMessageToChannel(discord, processOptions.discord?.channelId, msg);

            consoleLogger.push(
              `Placed new ${newDirection} order`,
              `Price: ${newOrderPrice}, OrderID: ${grid[i].orderId}`
            );
          } else {
            consoleLogger.push(
              `Skipped unprofitable ${newDirection} order`,
              `Price: ${newOrderPrice}, Potential Profit: ${(potentialProfit * 100).toFixed(2)}%`
            );
          }
        }
      }
    }
  }
  grid = grid.filter((item) => !item.executed);
  return orderExecuted;
};

function summarizeGrid(_openOrders: Order[], grid: GridLevel[]): object {
  const executedBuy = grid.filter((level) => level.type === "buy" && level.executed).length;
  const executedSell = grid.filter((level) => level.type === "sell" && level.executed).length;
  const pendingBuy = grid.filter((level) => level.type === "buy" && !level.executed).length;
  const pendingSell = grid.filter((level) => level.type === "sell" && !level.executed).length;
  return {
    executed: {
      buy: executedBuy,
      sell: executedSell,
    },
    open: {
      buy: pendingBuy,
      sell: pendingSell,
    },
  };
}

export const gridTrading = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  candlesticks: Candlesticks,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const balancesKey = throttleKeyBalances(exchangeOptions.name);
  if (shouldFetchData(balancesKey)) {
    exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
    markDataFetched(balancesKey);
  }
  const startTime = Date.now();
  consoleLogger.push("Time", startTime);
  const filter = symbolFilters[toSymbolKey(symbol)];

  if (candlesticks[toSymbolKey(symbol)] === undefined) {
    console.error(`${symbol}: candlesticks undefined`);
    return false;
  }

  const timeframe = Object.keys(candlesticks[toSymbolKey(symbol)]);
  if (candlesticks[toSymbolKey(symbol)][timeframe[0]] === undefined) {
    console.error(`${symbol}: timeframes[0] length == undefined`);
    return false;
  }

  if (candlesticks[toSymbolKey(symbol)][timeframe[0]]?.length < 2) {
    console.error(`${symbol}: timeframes[0] length < 2`);
    return false;
  }

  const symbolKey = toSymbolKey(symbol);
  if (exchangeOptions.tradeHistory === undefined) {
    exchangeOptions.tradeHistory = {};
  }
  const tradeHistoryKey = throttleKeyTradeHistory(exchangeOptions.name, symbolKey);
  if (shouldFetchData(tradeHistoryKey)) {
    exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbol);
    markDataFetched(tradeHistoryKey);
  }
  if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
    exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbol);
    markDataFetched(tradeHistoryKey);
  }

  if (exchangeOptions.tradeHistory[toSymbolKey(symbol)] === undefined) {
    console.error(`${symbol}: could not retrieve trade history`);
    return false;
  }

  const latestCandle =
    candlesticks[toSymbolKey(symbol)][timeframe[0]][
      candlesticks[toSymbolKey(symbol)][timeframe[0]]?.length - 1
    ];
  const currentPrice = latestCandle.close;

  consoleLogger.push("Symbol", toSymbolKey(symbol));
  consoleLogger.push("Current Price", currentPrice.toFixed(8));
  consoleLogger.push("Candle Time", new Date(latestCandle.time).toLocaleString());

  const openOrders = await getOpenOrders(exchange, symbol);
  // const filledOrders = orders.filter((order) => order.orderStatus.toLowerCase() === "filled");
  if (openOrders.length > 0) {
    symbolOptions.grid = buildGridFromExistingOrders(openOrders);
  }
  if (!symbolOptions.grid || openOrders.length === 0) {
    symbolOptions.grid = createGrid(currentPrice, symbolOptions);
    await placeGridOrders(exchange, consoleLogger, symbol, symbolOptions.grid, filter, exchangeOptions, symbolOptions);
  }

  if (isOutsideGridRange(currentPrice, symbolOptions.grid) || openOrders.length > symbolOptions.gridLevels * 2 - 1) {
    consoleLogger.push("Rebalancing grid", `Current price (${currentPrice}) is outside the grid range`);
    await rebalanceGrid(exchange, consoleLogger, symbol, currentPrice, filter, exchangeOptions, symbolOptions);
  }
  const orderExecuted = await manageGridOrders(
    discord,
    exchange,
    consoleLogger,
    openOrders,
    symbol,
    currentPrice,
    symbolOptions.grid,
    filter,
    processOptions,
    exchangeOptions,
    symbolOptions
  );

  consoleLogger.push(
    "Open Orders:",
    openOrders.map((order) => {
      return {
        orderId: order.orderId,
        price: order.price,
        side: order.isBuyer ? "buy" : "sell",
        qty: order.qty,
      };
    })
  );
  consoleLogger.push("Grid Status", summarizeGrid(openOrders, symbolOptions.grid));

  const stopTime = Date.now();
  consoleLogger.push(`Calculation speed (ms)`, stopTime - startTime);

  if (latestCandle.isFinal === true && shouldFetchData(tradeHistoryKey)) {
    exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
    markDataFetched(tradeHistoryKey);
  }
  const consoleMode = (exchangeOptions.console ?? "").toString().trim();
  const isFinalCandle = Boolean(latestCandle.isFinal);
  if (exchangeOptions.name === "binance") {
    if (consoleMode === "trade/final" && (orderExecuted !== false || isFinalCandle)) {
      consoleLogger.print("blue");
      consoleLogger.flush();
    } else if (consoleMode === "trade/final" && orderExecuted === false && !isFinalCandle) {
      consoleLogger.flush();
    } else if (consoleMode === "trade" && orderExecuted === true) {
      consoleLogger.print("blue");
      consoleLogger.flush();
    } else if (consoleMode === "trade" && orderExecuted === false) {
      consoleLogger.flush();
    } else if (consoleMode === "final" && isFinalCandle) {
      consoleLogger.print("blue");
      consoleLogger.flush();
    } else if (consoleMode === "final" && !isFinalCandle) {
      consoleLogger.flush();
    } else {
      consoleLogger.print("blue");
      consoleLogger.flush();
    }
  } else if (exchangeOptions.name === "xeggex" || exchangeOptions.name === "nonkyc") {
    if (consoleMode === "trade/final" && (orderExecuted !== false || isFinalCandle)) {
      consoleLogger.print("green");
      consoleLogger.flush();
    } else if (consoleMode === "trade/final" && orderExecuted === false && !isFinalCandle) {
      consoleLogger.flush();
    } else if (consoleMode === "trade" && orderExecuted === true) {
      consoleLogger.print("green");
      consoleLogger.flush();
    } else if (consoleMode === "trade" && orderExecuted === false) {
      consoleLogger.flush();
    } else if (consoleMode === "final" && isFinalCandle) {
      consoleLogger.print("green");
      consoleLogger.flush();
    } else if (consoleMode === "final" && !isFinalCandle) {
      consoleLogger.flush();
    } else {
      consoleLogger.print("green");
      consoleLogger.flush();
    }
  }
  return true;
};
