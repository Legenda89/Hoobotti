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
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { ConfigOptions, ExchangeOptions, SymbolOptions, getSecondsFromInterval, toSymbolKey } from "../Utilities/Args";

/** Stop loss, time-stop tai Extreme idle-pakko — sallii sulun myös tappiolla. */
export const allowsForcedLossTrade = (profit: string): boolean =>
  profit === "STOP_LOSS" || profit === "FORCE_IDLE" || profit === "STALE_EXIT";

import { Filter } from "./Filters";
import { shouldBlockForProfitMinimum } from "../Trading/profitMinimums";
import { markStopLossHit } from "../Indicators/Profit";
import { queueSimTradeSnapshot, simRunKeyFromStartTime } from "../Simulation/simTradeSnapshot";
import { handleOpenOrder, handleOpenOrders, Order, checkBeforePlacingOrder } from "./Orders";
import { sendMessageToChannel } from "../../Discord/discord";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { play } from "../Utilities/PlaySound";
import { getOrderbook, Orderbook } from "./Orderbook";
import { Balances, assignCurrentBalances, tradableBalance } from "./Balances";
import { logToFile, safeStringifyForLogs } from "../Utilities/LogToFile";
import path from "path";
import { Exchange, isBinance, isNonKYC } from "./Exchange";
import type Binance from "node-binance-api";
import { meetsTakeProfitLimitForAction, recordTakeProfitPeakOnOrder, resetTakeProfitRuntimeForSymbol } from "../Indicators/Profit";
import { isTerminalOrderStatus, shouldClearTakeProfitAfterOrder } from "../Trading/orderFill";
import {
  computeLiveBuyExecution,
  computeLiveSellExecution,
  capBuyQuoteByGrowingMax,
  MIN_QUOTE_NOTIONAL,
  simFeeOnBase,
  simFeeOnQuote,
  type LiveBuyExecution,
  type LiveSellExecution,
} from "../Trading/executionSizing";
import {
  liveBuyUsesAggressiveLimitPricing,
  liveOrderFollowUpDelayMs,
  resolveLiveBuyOrderMode,
  resolveLiveSellOrderMode,
  type LiveOrderExecutionMode,
} from "../Trading/liveOrderExecution";
import { applyFeeAdjustmentToPnl, liveEntryBuyPriceAcceptable } from "../Trading/tradeGates";
import {
  recordClosedRoundTripFromHistory,
  registerConsecutiveLossAfterClose,
  registerStopLossClose,
} from "../Trading/consecutiveLossGuard";
import { recordEntryForRateLimit, recordTradeFillForRateLimit } from "../Trading/churnGuard";
import { annotateTradesWithTriggers, recordTradeTrigger } from "../Trading/tradeTriggers";
import { noteTakeProfitFillOutcome, noteFullTakeProfitClose, shouldUsePartialTakeProfitClose } from "../Trading/partialTakeProfit";
import {
  invalidateDataFetch,
  markDataFetched,
  throttleKeyBalances,
  throttleKeyTradeHistory,
} from "../Utilities/DataFetchThrottle";
import { NonKYCResponse, NonKYCTrades } from "./NonKYC/NonKYC";

/**
 * Filter-fail (minNotional / qty / stale balance): vapauta lukitukset, päivitä saldot + orderbook.
 * Palauttaa tuoreen orderbookin tai null jos päivitys epäonnistui.
 */
const recoverAfterOrderFilterFail = async (
  side: "BUY" | "SELL",
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  orderBook: Orderbook,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  failDetails: Record<string, unknown>
): Promise<Orderbook | null> => {
  consoleLogger.push(`${side} FILTER FAIL — recovering`, failDetails);
  try {
    await handleOpenOrders(discord, exchange, symbol, orderBook, processOptions, symbolOptions, {
      forceCancelOpenOrders: true,
    });
  } catch (err) {
    consoleLogger.push("warning", `Filter-fail recovery: open-order cancel failed: ${String(err)}`);
  }
  try {
    await assignCurrentBalances(exchange, exchangeOptions);
    invalidateDataFetch(throttleKeyBalances(exchangeOptions.name));
  } catch (err) {
    consoleLogger.push("warning", `Filter-fail recovery: balance refresh failed: ${String(err)}`);
    return null;
  }
  try {
    const freshBook = await getOrderbook(exchange, symbol);
    consoleLogger.push(`${side} FILTER FAIL — balances refreshed`, {
      base: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]),
      quote: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[1]]),
      baseTotal: exchangeOptions.balances?.[symbol.split("/")[0]]?.crypto,
      quoteTotal: exchangeOptions.balances?.[symbol.split("/")[1]]?.crypto,
    });
    return freshBook;
  } catch (err) {
    consoleLogger.push("warning", `Filter-fail recovery: orderbook refresh failed: ${String(err)}`);
    return null;
  }
};

const rebuildSellExecutionAfterRecovery = (
  exchangeOptions: ExchangeOptions,
  symbol: string,
  orderBook: Orderbook,
  filter: Filter,
  symbolOptions: SymbolOptions,
  forceQuantityInBase: number | undefined
): LiveSellExecution | null => {
  return computeLiveSellExecution({
    baseBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]),
    orderBookAsks: orderBook.asks,
    filter,
    symbolOptions,
    forceQuantityInBase,
  });
};

const rebuildBuyExecutionAfterRecovery = (
  exchangeOptions: ExchangeOptions,
  symbol: string,
  orderBook: Orderbook,
  filter: Filter,
  symbolOptions: SymbolOptions,
  forceQuantityInBase: number | undefined,
  aggressiveEntry: boolean
): LiveBuyExecution | null => {
  return computeLiveBuyExecution({
    quoteBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[1]]),
    orderBookBids: orderBook.bids,
    orderBookAsks: orderBook.asks,
    filter,
    symbolOptions,
    forceQuantityInBase,
    aggressiveEntry,
  });
};

export const clearTakeProfitAfterTrade = (symbol: string, symbolOptions: SymbolOptions): void => {
  resetTakeProfitRuntimeForSymbol(toSymbolKey(symbol));
  if (symbolOptions.takeProfit !== undefined) {
    symbolOptions.takeProfit.current = 0;
  }
  if (symbolOptions.takeProfitBuy !== undefined) {
    symbolOptions.takeProfitBuy.current = 0;
  }
};

/** Sim: short-sulun PnL kun historiassa vain avaus (isBuyer false). */
export const computeSimBuyClosePnl = (
  tradeHistory: Trade[] | undefined,
  closePrice: number,
  tradeFeePercentage?: number
): number => {
  const th = tradeHistory ?? [];
  if (th.length < 1) return 0;
  const lastTrade = th[th.length - 1];
  if (!lastTrade.isBuyer) {
    let pnl = calculatePNLPercentageForShort(parseFloat(lastTrade.price), closePrice);
    pnl = applyFeeAdjustmentToPnl(pnl, tradeFeePercentage, lastTrade);
    return pnl;
  }
  return 0;
};

const awaitLiveOrderFollowUp = async (
  discord: Client,
  exchange: Exchange,
  symbol: string,
  order: Order,
  orderBook: Orderbook,
  processOptions: ConfigOptions,
  symbolOptions: SymbolOptions,
  tradeNext: "SELL" | "BUY",
  unrealizedPNL: number,
  orderMode: LiveOrderExecutionMode = "limit",
  preserveTakeProfitRuntime: boolean = false
): Promise<string> => {
  if (order.orderId === undefined) return "NO_ORDER_ID";
  recordTakeProfitPeakOnOrder(symbolOptions, tradeNext, unrealizedPNL);
  await delay(liveOrderFollowUpDelayMs(orderMode));
  const status = await handleOpenOrder(discord, exchange, symbol, order, orderBook, processOptions, symbolOptions);
  if (!preserveTakeProfitRuntime && shouldClearTakeProfitAfterOrder(status)) {
    clearTakeProfitAfterTrade(symbol, symbolOptions);
  }
  if (isTerminalOrderStatus(status)) {
    symbolOptions.currentOrder = undefined;
  }
  return status;
};

const soundFile = "./alarm.mp3";

const sleep = async (ms: number) => await new Promise((r) => setTimeout(r, ms));
const isBinanceTimestampAheadError = (error: any): boolean => {
  if (Number(error?.code) === -1021) return true;
  const msg = String(error?.body ?? error?.msg ?? error ?? "");
  return msg.includes("Timestamp for this request");
};
const syncBinanceServerTime = async (exchange: Exchange): Promise<void> => {
  if (!isBinance(exchange)) return;
  try {
    const binanceAny = exchange as any;
    if (typeof binanceAny.useServerTime === "function") {
      await binanceAny.useServerTime();
    }
  } catch (err) {
    logToFile("./logs/error.log", safeStringifyForLogs({ context: "syncBinanceServerTime", err }));
  }
};

export interface Trade {
  symbol: string;
  id: string;
  orderId: string;
  orderListID: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
  profit?: string;
}

export interface TradeHistory {
  [symbol: string]: Trade[];
}

export const listenForTrades = async (
  exchange: Exchange,
  symbol: string,
  callback: (trades: Trade) => Promise<void>
): Promise<void> => {
  if (isNonKYC(exchange)) {
    exchange.subscribeTrades(symbol, async (response: NonKYCResponse) => {
      if (response.params) {
        const trades = (response.params as NonKYCTrades).data;
        await callback({
          symbol: response.params.symbol,
          id: trades[0].id,
          orderId: trades[0].id,
          orderListID: 0,
          price: trades[0].price,
          qty: trades[0].quantity,
          quoteQty: "",
          commission: "",
          commissionAsset: "",
          time: new Date(trades[0].timestamp).getTime(),
          isBuyer: trades[0].side === "buy" ? true : false,
          isMaker: false,
          isBestMatch: true,
          profit: "",
        });
      }
    });
  } else if (isBinance(exchange)) {
    exchange.websockets.trades([toSymbolKey(symbol)], async (trades) => {
      await callback(trades);
    });
  }
};

export const calculateROI = (tradeHistory: Trade[]) => {
  if (tradeHistory.length >= 2) {
    let totalBase = 0;
    let totalQuote = 0;
    for (let i = 0; i < tradeHistory.length - 1; i++) {
      const currentTrade = tradeHistory[i];
      if (currentTrade.isBuyer) {
        const nextSellTrade = tradeHistory.slice(i, tradeHistory.length).find((trade) => !trade.isBuyer);
        if (nextSellTrade !== undefined) {
          totalBase += parseFloat(nextSellTrade.qty) - parseFloat(currentTrade.qty);
          totalQuote += parseFloat(nextSellTrade.quoteQty) - parseFloat(currentTrade.quoteQty);
        }
      } else {
        const nextBuyTrade = tradeHistory.slice(i, tradeHistory.length).find((trade) => trade.isBuyer);
        if (nextBuyTrade !== undefined) {
          totalBase += parseFloat(nextBuyTrade.qty) - parseFloat(currentTrade.qty);
          totalQuote += parseFloat(nextBuyTrade.quoteQty) - parseFloat(currentTrade.quoteQty);
        }
      }
    }
    return [totalBase, totalQuote];
  } else {
    return [0, 0];
  }
};

export const calculatePercentageDifference = (oldNumber: number, newNumber: number): number => {
  const difference = newNumber - oldNumber;
  const percentageDifference = (difference / Math.abs(oldNumber)) * 100;
  return percentageDifference;
};

export const calculatePNLPercentageForLong = (entryPrice: number, exitPrice: number): number => {
  return ((exitPrice - entryPrice) / entryPrice) * 100;
};

export const calculatePNLPercentageForShort = (entryPrice: number, exitPrice: number): number => {
  return ((entryPrice - exitPrice) / entryPrice) * 100;
};

export const calculateUnrealizedPNLPercentageForLong = (
  entryQty: number,
  entryPrice: number,
  highestBidPrice: number
): number => {
  return (((highestBidPrice - entryPrice) * entryQty) / (entryPrice * entryQty)) * 100;
};

export const calculateUnrealizedPNLPercentageForShort = (
  entryQty: number,
  entryPrice: number,
  lowestAskPrice: number
): number => {
  return (((entryPrice - lowestAskPrice) * entryQty) / (entryPrice * entryQty)) * 100;
};

export const getTradeHistory = async (exchange: Exchange, symbol: string) => {
  let tradeHistory: Trade[] = [];
  if (isBinance(exchange)) {
    try {
      tradeHistory = await exchange.trades(toSymbolKey(symbol));
    } catch (error) {
      if (isBinanceTimestampAheadError(error)) {
        console.warn(`Binance aikaheitto (trades ${symbol}) — synkataan serveriaika ja yritetään uudelleen.`);
        await syncBinanceServerTime(exchange);
        tradeHistory = await exchange.trades(toSymbolKey(symbol));
      } else {
        throw error;
      }
    }
    return annotateTradesWithTriggers(symbol, tradeHistory);
  } else if (isNonKYC(exchange)) {
    const history = await exchange.getAllTrades(symbol, 500, 0);
    history.sort((a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt);
    tradeHistory = history.map(
      (trade: {
        id: string;
        orderid: string;
        price: string;
        quantity: string;
        fee: any;
        alternateFeeAsset: any;
        createdAt: any;
        side: string;
      }) => ({
        symbol: toSymbolKey(symbol),
        id: parseFloat(trade.id),
        orderId: parseFloat(trade.orderid),
        orderListID: parseFloat(trade.orderid),
        price: trade.price,
        qty: trade.quantity,
        quoteQty: (parseFloat(trade.quantity) * parseFloat(trade.price)).toString(),
        commission: trade.fee,
        commissionAsset: trade.alternateFeeAsset,
        time: trade.createdAt,
        isBuyer: trade.side === "buy" ? true : false,
        isMaker: true,
        isBestMatch: true,
      })
    );
    return annotateTradesWithTriggers(symbol, tradeHistory);
  }
  return [];
};

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const updateForce = (symbol: string) => {
  const forcePath = "./settings/force.json";
  if (!existsSync(forcePath)) {
    return false;
  }
  try {
    const file = readFileSync(forcePath, "utf-8");
    const force = JSON.parse(file !== "" ? file : "{}");
    if (typeof force !== "object" || force === null) return false;
    const key = toSymbolKey(symbol);
    if (force[key] === undefined) {
      force[key] = { skip: false };
    } else {
      force[key].skip = false;
    }
    writeFileSync(forcePath, JSON.stringify(force));
    return true;
  } catch {
    return false;
  }
};

export const readForceSkip = (symbol: string): boolean => {
  if (process.env.SIMULATE === "true") {
    return false;
  }
  const forcePath = "./settings/force.json";
  if (!existsSync(forcePath)) {
    return false;
  }
  try {
    const file = readFileSync(forcePath, "utf-8");
    const force = JSON.parse(file !== "" ? file : "{}");
    if (typeof force !== "object" || force === null) return false;
    const key = toSymbolKey(symbol);
    if (force[key] === undefined) return false;
    const skip = force[key].skip;
    return skip === true;
  } catch {
    return false;
  }
};

var blocks: string[] = [];

export const isBlocking = async (symbol: string): Promise<boolean> => {
  symbol = symbol.replace("/", "");
  return blocks.includes(symbol);
};

/** Atominen varaus: true jos saatiin lukko, false jos symboli on jo blokattu. */
export const tryAcquireBlock = (symbol: string): boolean => {
  const key = symbol.replace("/", "");
  if (blocks.includes(key)) return false;
  blocks.push(key);
  return true;
};

export const createBlock = (symbol: string): void => {
  tryAcquireBlock(symbol);
};

export const removeBlock = async (symbol: string) => {
  symbol = symbol.replace("/", "");
  blocks = blocks.filter((block) => block !== symbol);
};

/** Binance market-fill: fills-keskiarvo, muuten quoteQty/qty, muuten price. */
export const averageFillPriceFromOrder = (
  order:
    | {
        price?: string | number;
        qty?: string | number;
        quoteQty?: string | number;
        executedQty?: string | number;
        cummulativeQuoteQty?: string | number;
        fills?: Array<{ price?: string | number; qty?: string | number }>;
      }
    | undefined
    | null
): number | undefined => {
  if (!order) return undefined;
  const fills = order.fills;
  if (Array.isArray(fills) && fills.length) {
    let quote = 0;
    let base = 0;
    for (const f of fills) {
      const p = parseFloat(String(f.price ?? ""));
      const q = parseFloat(String(f.qty ?? ""));
      if (p > 0 && q > 0) {
        quote += p * q;
        base += q;
      }
    }
    if (base > 0) return quote / base;
  }
  const quoteQty = parseFloat(String(order.quoteQty ?? order.cummulativeQuoteQty ?? ""));
  const baseQty = parseFloat(String(order.executedQty ?? order.qty ?? ""));
  if (quoteQty > 0 && baseQty > 0) return quoteQty / baseQty;
  const p = parseFloat(String(order.price ?? ""));
  return p > 0 ? p : undefined;
};

export const formatLiveTradeLogLine = (opts: {
  symbol: string;
  mode: string;
  side: "buy" | "sell";
  qty: number;
  requestedPrice?: number;
  order?: Parameters<typeof averageFillPriceFromOrder>[0];
}): string => {
  const fill = averageFillPriceFromOrder(opts.order);
  const requested =
    opts.requestedPrice != null && Number.isFinite(opts.requestedPrice) && opts.requestedPrice > 0
      ? opts.requestedPrice
      : undefined;
  const px = fill ?? requested;
  const pxPart = px != null ? ` @ ${px}` : "";
  return `${Date.now()} ${opts.symbol} ${opts.mode} ${opts.side} ${opts.qty} qty${pxPart} ok`;
};

const roundStep = (price: number, size: number): number => {
  const tickSizePrecision = Math.floor(Math.log10(Math.abs(size))) * -1;
  const roundedPrice = Math.round(price / size) * size;
  if (tickSizePrecision > 0 && tickSizePrecision < 100) {
    return Number(roundedPrice.toFixed(tickSizePrecision));
  } else {
    return Number(roundedPrice);
  }
};

export type PlaceOrderOptions = {
  mode?: LiveOrderExecutionMode;
};

export const placeSellOrder = async (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions,
  symbol: string,
  quantityInBase: number,
  price: number,
  maxRetries: number = 5,
  placeOpts?: PlaceOrderOptions
): Promise<Order | undefined> => {
  const mode = placeOpts?.mode ?? "limit";
  if (mode !== "market" && (price === undefined || Number.isNaN(price) || !(price > 0))) {
    console.error(`placeSellOrder blocked: invalid limit price ${price} for ${symbol}`);
    return undefined;
  }
  if (quantityInBase === undefined || Number.isNaN(quantityInBase) || !(quantityInBase > 0)) {
    console.error(`placeSellOrder blocked: invalid quantity ${quantityInBase} for ${symbol}`);
    return undefined;
  }
  if (exchangeOptions.dryRun === true) {
    logToFile(
      "./logs/trades-binance.log",
      `[DRY RUN] ${Date.now()} ${symbol} ${mode} sell ${quantityInBase} qty @ ${mode === "market" ? "MARKET" : price}`
    );
    const sym = toSymbolKey(symbol);
    return {
      symbol: sym,
      orderId: "dry-run-sell",
      price: String(price),
      qty: String(quantityInBase),
      quoteQty: String(quantityInBase * price),
      commission: "",
      commissionAsset: "",
      time: Date.now(),
      isBuyer: false,
      isMaker: true,
      isBestMatch: true,
      orderStatus: "NEW",
      tradeId: 0,
    };
  }
  let retries = 0;
  while (retries < maxRetries) {
    try {
      if (isBinance(exchange)) {
        let order: Order | undefined;
        if (mode === "market") {
          const binance = exchange as Binance & { marketSell?: (s: string, q: number) => Promise<Order> };
          if (typeof binance.marketSell === "function") {
            order = await binance.marketSell(toSymbolKey(symbol), quantityInBase);
          }
        }
        if (!order) {
          order = await exchange.sell(toSymbolKey(symbol), quantityInBase, price);
        }
        logToFile(
          "./logs/trades-binance.log",
          formatLiveTradeLogLine({
            symbol,
            mode,
            side: "sell",
            qty: quantityInBase,
            requestedPrice: price,
            order,
          })
        );
        return order;
      } else if (isNonKYC(exchange)) {
        logToFile(
          "./logs/trades-xeggex.log",
          `${Date.now().toLocaleString("fi-FI")}${symbol} sell at ${price} price, ${quantityInBase} qty`
        );
        const xeggexOrder = await exchange.newOrder(symbol, "sell", "limit", quantityInBase, price);
        if (xeggexOrder) {
          const order: Order = {
            symbol: toSymbolKey(symbol),
            orderId: xeggexOrder.id,
            price: xeggexOrder.price,
            qty: xeggexOrder.quantity,
            quoteQty: (parseFloat(xeggexOrder.quantity) * parseFloat(xeggexOrder.price)).toString(),
            commission: "",
            commissionAsset: "",
            time: xeggexOrder.createdAt,
            isBuyer: xeggexOrder.side === "buy" ? true : false,
            isMaker: true,
            isBestMatch: true,
            orderStatus: "NEW",
            tradeId: parseFloat(xeggexOrder.id),
          };
          return order;
        }
      }
    } catch (error) {
      retries++;
      console.error(`Error happened in placing SELL order ${error}, retrying (${retries}/${maxRetries})`);
      if (isBinanceTimestampAheadError(error)) {
        console.warn(`Binance aikaheitto (${symbol}) — synkataan serveriaika ja yritetään uudelleen.`);
        await syncBinanceServerTime(exchange);
      } else if (error?.code === 20001 || error?.code === -2021 || error?.code === -2010) {
        console.error(
          `Insufficient funds for SELL order creation in ${symbol}, decreasing quantity for next try by 1%`
        );
        quantityInBase = quantityInBase * 0.99;
        exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
      } else {
        logToFile("./logs/error.log", safeStringifyForLogs(error));
        console.error(error);
      }
      if (retries < maxRetries) {
        await sleep(500);
      }
    }
  }
  return undefined;
};

export const placeBuyOrder = async (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions,
  symbol: string,
  quantityInBase: number,
  price: number,
  maxRetries: number = 5,
  placeOpts?: PlaceOrderOptions
): Promise<Order | undefined> => {
  const mode = placeOpts?.mode ?? "limit";
  if (mode !== "market" && (price === undefined || Number.isNaN(price) || !(price > 0))) {
    console.error(`placeBuyOrder blocked: invalid limit price ${price} for ${symbol}`);
    return undefined;
  }
  if (quantityInBase === undefined || Number.isNaN(quantityInBase) || !(quantityInBase > 0)) {
    console.error(`placeBuyOrder blocked: invalid quantity ${quantityInBase} for ${symbol}`);
    return undefined;
  }
  if (exchangeOptions.dryRun === true) {
    logToFile(
      "./logs/trades-binance.log",
      `[DRY RUN] ${Date.now()} ${symbol} ${mode} buy ${quantityInBase} qty @ ${mode === "market" ? "MARKET" : price}`
    );
    const sym = toSymbolKey(symbol);
    return {
      symbol: sym,
      orderId: "dry-run-buy",
      price: String(price),
      qty: String(quantityInBase),
      quoteQty: String(quantityInBase * price),
      commission: "",
      commissionAsset: "",
      time: Date.now(),
      isBuyer: true,
      isMaker: true,
      isBestMatch: true,
      orderStatus: "NEW",
      tradeId: 0,
    };
  }
  let retries = 0;
  while (retries < maxRetries) {
    try {
      if (isBinance(exchange)) {
        let order: Order | undefined;
        if (mode === "market") {
          const binance = exchange as Binance & { marketBuy?: (s: string, q: number) => Promise<Order> };
          if (typeof binance.marketBuy === "function") {
            order = await binance.marketBuy(toSymbolKey(symbol), quantityInBase);
          }
        }
        if (!order) {
          order = await exchange.buy(toSymbolKey(symbol), quantityInBase, price);
        }
        logToFile(
          "./logs/trades-binance.log",
          formatLiveTradeLogLine({
            symbol,
            mode,
            side: "buy",
            qty: quantityInBase,
            requestedPrice: price,
            order,
          })
        );
        return order;
      } else if (isNonKYC(exchange)) {
        logToFile(
          "./logs/trades-xeggex.log",
          `${Date.now().toLocaleString("fi-FI")} ${symbol} buy at ${price} price, ${quantityInBase} qty`
        );
        const xeggexOrder = await exchange.newOrder(symbol, "buy", "limit", quantityInBase, price);
        const order = {
          symbol: toSymbolKey(symbol),
          orderId: xeggexOrder.id,
          price: xeggexOrder.price,
          qty: xeggexOrder.quantity,
          quoteQty: (parseFloat(xeggexOrder.quantity) * parseFloat(xeggexOrder.price)).toString(),
          commission: "",
          commissionAsset: "",
          time: xeggexOrder.createdAt,
          isBuyer: xeggexOrder.side === "buy" ? true : false,
          isMaker: true,
          isBestMatch: true,
          orderStatus: "NEW",
          tradeId: parseFloat(xeggexOrder.id),
        };
        return order;
      }
    } catch (error) {
      retries++;
      console.error(`Error happened in placing BUY order ${error}, retrying (${retries}/${maxRetries})`);
      if (isBinanceTimestampAheadError(error)) {
        console.warn(`Binance aikaheitto (${symbol}) — synkataan serveriaika ja yritetään uudelleen.`);
        await syncBinanceServerTime(exchange);
      } else if (error?.code === 20001 || error?.code === -2021 || error?.code === -2010) {
        console.error(`Insufficient funds for BUY order creation in ${symbol}, decreasing quantity for next try by 1%`);
        quantityInBase = quantityInBase * 0.99;
        exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
      } else {
        logToFile("./logs/error.log", safeStringifyForLogs(error));
        console.error(error);
      }
      if (retries < maxRetries) {
        await sleep(500);
      }
    }
  }
  console.error(`Max retries reached for placing buy order in ${symbol}`);
  return undefined;
};

export const getPreviousTrades = (
  direction: string,
  ExchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions
) => {
  const trades = ExchangeOptions.tradeHistory?.[toSymbolKey(symbolOptions.name)];
  let previousTrade = null;
  let olderTrade = null;
  if (!trades?.length) return { previousTrade, olderTrade };
  for (let i = trades.length - 1; i >= 0; i--) {
    if (direction === "SELL" && trades[i].isBuyer) {
      previousTrade = trades[i];
      for (let x = i; x >= 0; x--) {
        if (!trades[x].isBuyer) {
          olderTrade = trades[x];
          break;
        }
      }
      break;
    } else if (direction === "BUY" && !trades[i].isBuyer) {
      previousTrade = trades[i];
      for (let x = i; x >= 0; x--) {
        if (trades[x].isBuyer) {
          olderTrade = trades[x];
          break;
        }
      }
      break;
    }
  }
  return { previousTrade, olderTrade };
};

export const sell = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  profit: string,
  orderBook: Orderbook,
  filter: Filter,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  forceQuantityInBase: number | undefined
): Promise<Order | boolean> => {
  const sellMode = resolveLiveSellOrderMode(symbolOptions, profit);
  let baseBalance = tradableBalance(exchangeOptions.balances![symbol.split("/")[0]]);
  if (orderBook === undefined || orderBook.asks === undefined) {
    orderBook = await getOrderbook(exchange, symbol);
  }
  let sellExec = computeLiveSellExecution({
    baseBalance,
    orderBookAsks: orderBook.asks,
    filter,
    symbolOptions,
    forceQuantityInBase,
  });
  if (sellExec === null) {
    return false;
  }
  let {
    askPrice,
    askPriceDiscounted,
    quantityInBase,
    roundedPrice,
    roundedQuantityInBase,
    roundedQuantityInQuote,
  } = sellExec;
  if (
    symbolOptions.price?.enabled === true &&
    symbolOptions.price?.maximumSell !== undefined &&
    symbolOptions.price?.maximumSell < roundedPrice
  ) {
    consoleLogger.push("error", "Too high price to sell.");
    return false;
  }
  if (
    symbolOptions.price?.enabled === true &&
    symbolOptions.price?.minimumSell !== undefined &&
    symbolOptions.price?.minimumSell > roundedPrice
  ) {
    consoleLogger.push("error", "Too low price to sell.");
    return false;
  }
  consoleLogger.push("SELL CHECK", {
    baseBalance,
    orderMode: sellMode,
    askPrice,
    askPriceDiscounted,
    quantityInBase,
    roundedQuantityInBase,
    roundedQuantityInQuote,
    stepSize: filter.stepSize,
    tickSize: filter.tickSize,
  });
  if (roundedQuantityInQuote < MIN_QUOTE_NOTIONAL) {
    consoleLogger.push("error", "Too low quantity to sell. Minimum 1.1 Quote.");
    return false;
  }
  if (process.env.DEBUG == "true") {
    logToFile(
      "./logs/debug.log",
      `TRADEDATA SELL ${orderBook.asks[0]} ${askPrice} ${askPriceDiscounted} ${filter.tickSize} ${roundedPrice} ${roundedQuantityInBase} ${roundedQuantityInQuote}`
    );
  }
  if (checkBeforePlacingOrder(roundedQuantityInBase, roundedPrice, filter) !== true) {
    const recoveredBook = await recoverAfterOrderFilterFail(
      "SELL",
      discord,
      exchange,
      consoleLogger,
      symbol,
      orderBook,
      processOptions,
      exchangeOptions,
      symbolOptions,
      {
        roundedQuantityInBase,
        roundedPrice,
        notional: roundedQuantityInBase * roundedPrice,
        filter,
      }
    );
    if (recoveredBook) {
      orderBook = recoveredBook;
      sellExec = rebuildSellExecutionAfterRecovery(
        exchangeOptions,
        symbol,
        orderBook,
        filter,
        symbolOptions,
        forceQuantityInBase
      );
      if (sellExec) {
        ({
          askPrice,
          askPriceDiscounted,
          quantityInBase,
          roundedPrice,
          roundedQuantityInBase,
          roundedQuantityInQuote,
        } = sellExec);
        baseBalance = tradableBalance(exchangeOptions.balances![symbol.split("/")[0]]);
        consoleLogger.push("SELL CHECK (retry after recovery)", {
          baseBalance,
          available: exchangeOptions.balances![symbol.split("/")[0]]?.available,
          onOrder: exchangeOptions.balances![symbol.split("/")[0]]?.onOrder,
          orderMode: sellMode,
          askPrice,
          roundedQuantityInBase,
          roundedQuantityInQuote,
          roundedPrice,
        });
      }
    }
  }
  if (checkBeforePlacingOrder(roundedQuantityInBase, roundedPrice, filter) === true) {
    let unrealizedPNL = 0;
    if (profit !== "GRID" && profit !== "SKIP") {
      if (
        exchangeOptions.tradeHistory !== undefined &&
        exchangeOptions.tradeHistory[toSymbolKey(symbol)]?.length > 0
      ) {
        const { previousTrade, olderTrade } = getPreviousTrades("SELL", exchangeOptions, symbolOptions);
        if (previousTrade) {
          unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
            parseFloat(previousTrade.qty),
            parseFloat(previousTrade.price),
            roundedPrice // Use discounted ask price for PNL calculation
          );
          unrealizedPNL = applyFeeAdjustmentToPnl(
            unrealizedPNL,
            symbolOptions.tradeFeePercentage,
            previousTrade
          );
          if (
            (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") &&
            !meetsTakeProfitLimitForAction(unrealizedPNL, symbolOptions, "SELL")
          ) {
            consoleLogger.push(
              "error",
              `Take profit estetty: unrealized ${unrealizedPNL.toFixed(2)}% alle takeProfit.limit`
            );
            return false;
          }
          if (
            !allowsForcedLossTrade(profit) &&
            shouldBlockForProfitMinimum(
              unrealizedPNL,
              "SELL",
              symbolOptions,
              profit,
              readForceSkip(toSymbolKey(symbol)) === true
            )
          ) {
            consoleLogger.push("error", "Not positive trade " + unrealizedPNL);
            return false;
          }
          if (!allowsForcedLossTrade(profit) && unrealizedPNL < 0) {
            consoleLogger.push("error", `Estetty miinusmyynti (${profit}): unrealized PNL ${unrealizedPNL}`);
            return false;
          }
        }
      }
    }
    if (!tryAcquireBlock(symbol)) {
      return false;
    }
    try {
      let order = await placeSellOrder(exchange, exchangeOptions, symbol, roundedQuantityInBase, roundedPrice, 5, {
        mode: sellMode,
      });
      const tradeNext = "SELL";
      if (order !== undefined) {
        play(soundFile);
        let msg = "```";
        msg += `SELL ID: ${order.orderId}\r\n`;
        msg += `Symbol: ${symbol}\r\n`;
        msg += `Order type: ${sellMode}\r\n`;
        msg += `Base quantity: ${roundedQuantityInBase}\r\n`;
        msg += `Quote quantity: ${roundedQuantityInQuote}\r\n`;
        msg += `Price: ${roundedPrice}\r\n`;
        msg += `Profit if trade fulfills: ${unrealizedPNL.toFixed(2)}%\r\n`;
        msg += `Trigger: ${profit}\r\n`;
        msg += `Time now ${new Date().toLocaleString("fi-fi")}\r\n`;
        msg += "```";

        const filledOrMarket = order.orderStatus === "FILLED" || sellMode === "market";
        if (filledOrMarket) {
          symbolOptions.currentOrder = undefined;
        } else {
          symbolOptions.currentOrder = order;
        }
        // STOP_LOSS cooldown/hit only after fill (or market); limit NEW must wait for follow-up.
        if (profit === "STOP_LOSS" && filledOrMarket) {
          markStopLossHit(symbolOptions, "SELL");
          registerStopLossClose(toSymbolKey(symbol), symbolOptions);
        }
        recordTradeTrigger(symbol, profit, {
          orderId: order.orderId,
          time: Date.now(),
        });
        sendMessageToChannel(discord, processOptions.discord?.channelId, msg);
        let followUpStatus: string | undefined;
        const intendPartialClose = forceQuantityInBase != null && forceQuantityInBase > 0 && profit === "TAKE_PROFIT";
        if (order.orderId !== undefined) {
          followUpStatus = await awaitLiveOrderFollowUp(
            discord,
            exchange,
            symbol,
            order,
            orderBook,
            processOptions,
            symbolOptions,
            tradeNext,
            unrealizedPNL,
            sellMode,
            intendPartialClose
          );
          if (profit === "STOP_LOSS" && !filledOrMarket && followUpStatus === "FILLED") {
            markStopLossHit(symbolOptions, "SELL");
            registerStopLossClose(toSymbolKey(symbol), symbolOptions);
          }
        }
        const countedAsFillEarly = filledOrMarket || followUpStatus === "FILLED";
        if (intendPartialClose && countedAsFillEarly) {
          noteTakeProfitFillOutcome(symbolOptions, profit, "SELL", true);
        } else if (
          countedAsFillEarly &&
          (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE")
        ) {
          noteFullTakeProfitClose(symbolOptions, profit, "SELL", unrealizedPNL);
        }
        updateBuyAmount(roundedQuantityInQuote, symbolOptions);
        updateForce(symbol);
        await assignCurrentBalances(exchange, exchangeOptions);
        if (exchangeOptions.tradeHistory === undefined) {
          exchangeOptions.tradeHistory = {};
        }
        exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
        const symbolKeyClosed = toSymbolKey(symbol);
        recordClosedRoundTripFromHistory(symbolKeyClosed, symbolOptions, exchangeOptions.tradeHistory[symbolKeyClosed]);
        const thKey = throttleKeyTradeHistory(exchangeOptions.name, toSymbolKey(symbol));
        invalidateDataFetch(thKey);
        markDataFetched(thKey);
        const sk = toSymbolKey(symbol);
        const countedAsFill = filledOrMarket || followUpStatus === "FILLED";
        if (countedAsFill) {
          recordTradeFillForRateLimit(sk);
        }
        if (profit === "BUY" || profit === "SELL" || profit === "SKIP") {
          recordEntryForRateLimit(sk);
        }
        return order;
      }
      return false;
    } finally {
      await removeBlock(symbol);
    }
  } else {
    consoleLogger.push("SELL FILTER FAIL (after recovery)", {
      roundedQuantityInBase,
      roundedPrice,
      notional: roundedQuantityInBase * roundedPrice,
      filter,
      baseBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]),
      quoteBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[1]]),
    });
    consoleLogger.push("error", "Filter limits failed a check. Check your balances!");
    return false;
  }
};

const maxBuyAmount = (quoteQuantity: number, symbolOptions: SymbolOptions, applyGrowingMaxCap: boolean = true) => {
  if (!applyGrowingMaxCap) {
    return quoteQuantity;
  }
  if (symbolOptions.growingMax) {
    if (symbolOptions.growingMax.buy === undefined) {
      return quoteQuantity;
    } else if (symbolOptions.growingMax.buy > 0) {
      return (quoteQuantity = Math.min(quoteQuantity, symbolOptions.growingMax.buy));
    } else {
      return quoteQuantity;
    }
  } else {
    return quoteQuantity;
  }
};

const updateBuyAmount = (quoteQuantity: number, symbolOptions: SymbolOptions) => {
  if (symbolOptions.growingMax) {
    if (symbolOptions.growingMax.buy > 0) {
      symbolOptions.growingMax.buy = Math.max(quoteQuantity, symbolOptions.growingMax.buy);
    }
  }
};

const maxSellAmount = (baseQuantity: number, symbolOptions: SymbolOptions) => {
  if (symbolOptions.growingMax) {
    if (symbolOptions.growingMax.sell === undefined) {
      return baseQuantity;
    } else if (symbolOptions.growingMax.sell > 0) {
      return (baseQuantity = Math.min(baseQuantity, symbolOptions.growingMax.sell));
    } else {
      return baseQuantity;
    }
  } else {
    return baseQuantity;
  }
};

const updateSellAmount = (baseQuantity: number, symbolOptions: SymbolOptions) => {
  if (symbolOptions.growingMax) {
    if (symbolOptions.growingMax.sell > 0) {
      symbolOptions.growingMax.sell = Math.max(baseQuantity, symbolOptions.growingMax.sell);
    }
  }
};

export const buy = async (
  discord: Client,
  exchange: Exchange,
  consoleLogger: ConsoleLogger,
  symbol: string,
  profit: string,
  orderBook: any,
  filter: Filter,
  processOptions: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  forceQuantityInBase: number | undefined
): Promise<Order | boolean> => {
  let quoteBalance = tradableBalance(exchangeOptions.balances![symbol.split("/")[1]]);
  if (orderBook === undefined || orderBook.bids === undefined) {
    orderBook = await getOrderbook(exchange, symbol);
  }
  const buyMode = resolveLiveBuyOrderMode(symbolOptions, profit);
  const aggressiveEntry = liveBuyUsesAggressiveLimitPricing(buyMode);
  let buyExec = computeLiveBuyExecution({
    quoteBalance,
    orderBookBids: orderBook.bids,
    orderBookAsks: orderBook.asks,
    filter,
    symbolOptions,
    forceQuantityInBase,
    aggressiveEntry,
  });
  if (buyExec === null) {
    return false;
  }
  let { bidPrice, bidPriceIncremented, roundedPrice, roundedQuantityInBase, roundedQuantityInQuote } = buyExec;
  if (
    symbolOptions.price?.enabled === true &&
    symbolOptions.price?.maximumBuy !== undefined &&
    symbolOptions.price?.maximumBuy < roundedPrice
  ) {
    consoleLogger.push("error", "Too high price to buy.");
    return false;
  }
  if (
    symbolOptions.price?.enabled === true &&
    symbolOptions.price?.minimumBuy !== undefined &&
    symbolOptions.price?.minimumBuy > roundedPrice
  ) {
    consoleLogger.push("error", "Too low price to buy.");
    return false;
  }
  consoleLogger.push("BUY CHECK", {
    quoteBalance: tradableBalance(exchangeOptions.balances![symbol.split("/")[1]]),
    baseBalance: tradableBalance(exchangeOptions.balances![symbol.split("/")[0]]),
    quoteTotal: exchangeOptions.balances![symbol.split("/")[1]]?.crypto,
    baseTotal: exchangeOptions.balances![symbol.split("/")[0]]?.crypto,
    bidPrice,
    orderMode: buyMode,
    aggressiveEntry,
    quantityInQuote: roundedQuantityInQuote,
    quantityInBase: roundedQuantityInBase,
    roundedPrice,
    roundedQuantityInBase,
    roundedQuantityInQuote,
    stepSize: filter.stepSize,
    tickSize: filter.tickSize,
    filters: filter,
  });
  if (roundedQuantityInQuote < MIN_QUOTE_NOTIONAL) {
    consoleLogger.push("error", "Too low quantity to buy. Minimum 1.1 Quote.");
    return false;
  }
  if (
    buyMode !== "market" &&
    !liveEntryBuyPriceAcceptable(roundedPrice, orderBook, symbolOptions.tradeFeePercentage, profit)
  ) {
    consoleLogger.push(
      "error",
      `Entry buy price ${roundedPrice} exceeds orderbook mid slippage tolerance (profit=${profit})`
    );
    return false;
  }
  if (process.env.DEBUG == "true") {
    logToFile(
      "./logs/debug.log",
      `TRADEDATA BUY ${orderBook.bids[0]} ${bidPrice} ${bidPriceIncremented} ${filter.tickSize} ${roundedPrice} ${roundedQuantityInBase} ${roundedQuantityInQuote}`
    );
  }
  if (checkBeforePlacingOrder(roundedQuantityInBase, roundedPrice, filter) !== true) {
    const recoveredBook = await recoverAfterOrderFilterFail(
      "BUY",
      discord,
      exchange,
      consoleLogger,
      symbol,
      orderBook,
      processOptions,
      exchangeOptions,
      symbolOptions,
      {
        roundedQuantityInBase,
        roundedPrice,
        notional: roundedQuantityInBase * roundedPrice,
        filter,
      }
    );
    if (recoveredBook) {
      orderBook = recoveredBook;
      buyExec = rebuildBuyExecutionAfterRecovery(
        exchangeOptions,
        symbol,
        orderBook,
        filter,
        symbolOptions,
        forceQuantityInBase,
        aggressiveEntry
      );
      if (buyExec) {
        ({ bidPrice, bidPriceIncremented, roundedPrice, roundedQuantityInBase, roundedQuantityInQuote } = buyExec);
        quoteBalance = tradableBalance(exchangeOptions.balances![symbol.split("/")[1]]);
        consoleLogger.push("BUY CHECK (retry after recovery)", {
          quoteBalance,
          available: exchangeOptions.balances![symbol.split("/")[1]]?.available,
          onOrder: exchangeOptions.balances![symbol.split("/")[1]]?.onOrder,
          bidPrice,
          roundedQuantityInBase,
          roundedQuantityInQuote,
          roundedPrice,
        });
      }
    }
  }
  if (checkBeforePlacingOrder(roundedQuantityInBase, roundedPrice, filter) === true) {
    let unrealizedPNL = 0;
    if (profit !== "GRID" && profit !== "SKIP") {
      if (
        exchangeOptions.tradeHistory !== undefined &&
        exchangeOptions.tradeHistory[toSymbolKey(symbol)]?.length > 0
      ) {
        const { previousTrade, olderTrade } = getPreviousTrades("BUY", exchangeOptions, symbolOptions);
        if (previousTrade) {
          unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
            parseFloat(previousTrade.qty),
            parseFloat(previousTrade.price),
            roundedPrice // Use incremented bid price for PNL calculation
          );
          unrealizedPNL = applyFeeAdjustmentToPnl(
            unrealizedPNL,
            symbolOptions.tradeFeePercentage,
            previousTrade
          );
          if (
            (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") &&
            !meetsTakeProfitLimitForAction(unrealizedPNL, symbolOptions, "BUY")
          ) {
            consoleLogger.push(
              "error",
              `Take profit estetty: unrealized ${unrealizedPNL.toFixed(2)}% alle takeProfit.limit`
            );
            return false;
          }
          if (
            !allowsForcedLossTrade(profit) &&
            shouldBlockForProfitMinimum(
              unrealizedPNL,
              "BUY",
              symbolOptions,
              profit,
              readForceSkip(toSymbolKey(symbol)) === true
            )
          ) {
            consoleLogger.push("error", "Not positive trade " + unrealizedPNL);
            return false;
          }
          if (!allowsForcedLossTrade(profit) && unrealizedPNL < 0) {
            consoleLogger.push("error", `Estetty osto tappiolla (${profit}): unrealized PNL ${unrealizedPNL}`);
            return false;
          }
        }
      }
    }
    if (!tryAcquireBlock(symbol)) {
      return false;
    }
    try {
      let order = await placeBuyOrder(exchange, exchangeOptions, symbol, roundedQuantityInBase, roundedPrice, 5, {
        mode: buyMode,
      });
      const tradeNext = "BUY";
      if (order !== undefined) {
        play(soundFile);
        let msg = "```";
        msg += `BUY ID: ${order.orderId}\r\n`;
        msg += `Symbol: ${symbol}\r\n`;
        msg += `Order type: ${buyMode}\r\n`;
        msg += `Base quantity: ${roundedQuantityInBase}\r\n`;
        msg += `Quote quantity: ${roundedQuantityInQuote}\r\n`;
        msg += `Price: ${roundedPrice}\r\n`;
        msg += `Profit if trade fulfills: ${unrealizedPNL.toFixed(2)}%\r\n`;
        msg += `Trigger: ${profit}\r\n`;
        msg += `Time now ${new Date().toLocaleString("fi-fi")}\r\n`;
        msg += "```";

        const filledOrMarket = order.orderStatus === "FILLED" || buyMode === "market";
        if (filledOrMarket) {
          symbolOptions.currentOrder = undefined;
        } else {
          symbolOptions.currentOrder = order;
        }
        if (profit === "STOP_LOSS" && filledOrMarket) {
          markStopLossHit(symbolOptions, "BUY");
          registerStopLossClose(toSymbolKey(symbol), symbolOptions);
        }
        recordTradeTrigger(symbol, profit, {
          orderId: order.orderId,
          time: Date.now(),
        });
        sendMessageToChannel(discord, processOptions.discord?.channelId, msg);
        let followUpStatus: string | undefined;
        const intendPartialClose = forceQuantityInBase != null && forceQuantityInBase > 0 && profit === "TAKE_PROFIT";
        if (order.orderId !== undefined) {
          followUpStatus = await awaitLiveOrderFollowUp(
            discord,
            exchange,
            symbol,
            order,
            orderBook,
            processOptions,
            symbolOptions,
            tradeNext,
            unrealizedPNL,
            buyMode,
            intendPartialClose
          );
          if (profit === "STOP_LOSS" && !filledOrMarket && followUpStatus === "FILLED") {
            markStopLossHit(symbolOptions, "BUY");
            registerStopLossClose(toSymbolKey(symbol), symbolOptions);
          }
        }
        if (intendPartialClose && (filledOrMarket || followUpStatus === "FILLED")) {
          noteTakeProfitFillOutcome(symbolOptions, profit, "BUY", true);
        } else if (
          (filledOrMarket || followUpStatus === "FILLED") &&
          (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE")
        ) {
          noteFullTakeProfitClose(symbolOptions, profit, "BUY", unrealizedPNL);
        }
        updateSellAmount(roundedQuantityInBase, symbolOptions);
        updateForce(symbol);
        await assignCurrentBalances(exchange, exchangeOptions);
        if (exchangeOptions.tradeHistory === undefined) {
          exchangeOptions.tradeHistory = {};
        }
        exchangeOptions.tradeHistory[toSymbolKey(symbol)] = await getTradeHistory(exchange, symbol);
        const thKey = throttleKeyTradeHistory(exchangeOptions.name, toSymbolKey(symbol));
        invalidateDataFetch(thKey);
        markDataFetched(thKey);
        const sk = toSymbolKey(symbol);
        const countedAsFill = filledOrMarket || followUpStatus === "FILLED";
        if (countedAsFill) {
          recordTradeFillForRateLimit(sk);
        }
        if (profit === "BUY" || profit === "SELL" || profit === "SKIP") {
          recordEntryForRateLimit(sk);
        }
        return order;
      }
      return false;
    } finally {
      await removeBlock(symbol);
    }
  } else {
    consoleLogger.push("BUY FILTER FAIL (after recovery)", {
      roundedQuantityInBase,
      roundedPrice,
      notional: roundedQuantityInBase * roundedPrice,
      filter,
      baseBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[0]]),
      quoteBalance: tradableBalance(exchangeOptions.balances?.[symbol.split("/")[1]]),
    });
    consoleLogger.push("error", "Filter limits failed a check. Check your balances!");
    return false;
  }
};

export const checkPreviousTrade = (symbol: string, exchangeOptions: ExchangeOptions) => {
  let check = "SELL";
  const symbolKey = toSymbolKey(symbol);
  const th = exchangeOptions.tradeHistory?.[symbolKey] ?? [];
  if (th.length > 0) {
    const lastTrade = th[th.length - 1];
    if (lastTrade.isBuyer) {
      check = "BUY";
    } else {
      check = "SELL";
    }
  }
  return check;
};

export const simulateSell = async (
  symbol: string,
  quantity: number,
  price: number,
  balances: Balances,
  profit: string,
  options: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  time: number,
  filter: Filter,
  logger: ConsoleLogger
) => {
  // console.log(time);
  if (price === null || quantity === 0) {
    return false;
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return false;
  }
  let baseQuantity = quantity;
  let quoteQuantity = quantity * price;
  if (checkBeforePlacingOrder(baseQuantity, price, filter) === true) {
    let fee = simFeeOnQuote(quoteQuantity, symbolOptions.tradeFeePercentage);
    let quoteQuontityWithoutFee = quoteQuantity - fee;
    let lastTrade: Trade = {
      symbol: "",
      id: "",
      orderId: "",
      orderListID: 0,
      price: "",
      qty: "",
      quoteQty: "",
      commission: "",
      commissionAsset: "",
      time: 0,
      isBuyer: true,
      isMaker: true,
      isBestMatch: true,
    };
    let pnl = 0;
    const symbolKeyS = toSymbolKey(symbol);
    const thS = exchangeOptions.tradeHistory?.[symbolKeyS];
    if ((thS?.length ?? 0) >= 1) {
      lastTrade = thS![thS!.length - 1];
      if (lastTrade.isBuyer) {
        pnl = calculatePNLPercentageForLong(parseFloat(lastTrade.price), price);
        pnl = applyFeeAdjustmentToPnl(pnl, symbolOptions.tradeFeePercentage, lastTrade);
      }
    }
    if (
      (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") &&
      !meetsTakeProfitLimitForAction(pnl, symbolOptions, "SELL")
    ) {
      return false;
    }
    // Prevent "minus trades" unless stop loss / idle force.
    if (!allowsForcedLossTrade(profit) && pnl < 0) {
      return false;
    }
    if (exchangeOptions.tradeHistory === undefined) {
      exchangeOptions.tradeHistory = {};
    }
    if (exchangeOptions.tradeHistory[symbolKeyS] === undefined) {
      exchangeOptions.tradeHistory[symbolKeyS] = [];
    }
    if (
      !allowsForcedLossTrade(profit) &&
      shouldBlockForProfitMinimum(pnl, "SELL", symbolOptions, profit, readForceSkip(symbolKeyS) === true)
    ) {
      return false;
    }
    exchangeOptions.tradeHistory[symbolKeyS].push({
      symbol: symbolKeyS,
      id: "",
      orderId: "",
      orderListID: pnl,
      price: price.toString(),
      qty: baseQuantity.toString(),
      quoteQty: quoteQuontityWithoutFee.toString(),
      commission: fee.toString(),
      commissionAsset: symbol.split("/")[1],
      time: time,
      isBuyer: false,
      isMaker: true,
      isBestMatch: true,
      profit: profit,
    });
    if (process.env.SIMULATE === "true") {
      console.log(
        `[sim] SELL ${symbol} @ ${price.toFixed(2)} base≈${baseQuantity.toFixed(6)} (${profit}) | kauppoja yhteensä ${exchangeOptions.tradeHistory[symbolKeyS].length}`
      );
    }
    const baseCoin = symbol.split("/")[0];
    const quoteCoin = symbol.split("/")[1];
    balances[baseCoin].crypto = balances[baseCoin].crypto - baseQuantity;
    balances[quoteCoin].crypto = balances[quoteCoin].crypto + quoteQuontityWithoutFee;
    const sanitizedStartTime = simRunKeyFromStartTime(options.startTime);
    if (!shouldUsePartialTakeProfitClose(symbolOptions, profit, "SELL")) {
      if (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") {
        noteFullTakeProfitClose(symbolOptions, profit, "SELL", pnl);
      }
      clearTakeProfitAfterTrade(symbol, symbolOptions);
    }
    updateBuyAmount(quoteQuantity, symbolOptions);
    queueSimTradeSnapshot(sanitizedStartTime, {
      symbol: symbol,
      direction: "SELL",
      quantity: baseQuantity,
      price: price,
      balances: balances,
      tradeHistory: exchangeOptions.tradeHistory,
    });
    if (profit === "STOP_LOSS") {
      markStopLossHit(symbolOptions, "SELL");
      registerStopLossClose(symbolKeyS, symbolOptions);
    }
    if (pnl < 0 && !shouldUsePartialTakeProfitClose(symbolOptions, profit, "SELL")) {
      registerConsecutiveLossAfterClose(symbolKeyS, symbolOptions, pnl);
    }
    recordTradeFillForRateLimit(symbolKeyS);
    if (profit === "BUY" || profit === "SELL" || profit === "SKIP") {
      recordEntryForRateLimit(symbolKeyS);
    }
    // logger.flush();
    // logger.push("Time", (new Date(time)).toLocaleString());
    logger.push("trade", "sell");
    logger.push("PNL", pnl);
    logger.push("Trigger", profit);
    // logger.push("Balances", balances);
    // logger.print();
    // logger.flush();
    return true;
  }
  return false;
};

export const simulateBuy = async (
  symbol: string,
  quantity: number,
  price: number,
  balances: Balances,
  profit: string,
  options: ConfigOptions,
  exchangeOptions: ExchangeOptions,
  symbolOptions: SymbolOptions,
  time: number,
  filter: Filter,
  logger: ConsoleLogger
): Promise<Boolean> => {
  // console.log(time);
  if (price === null || quantity === 0) {
    return false;
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return false;
  }
  const quoteBalanceBefore = quantity;
  let quoteQuantity = quantity;
  const fixedBuyAmount = Number(symbolOptions.simulationBuyAmountQuote ?? 0);
  if (Number.isFinite(fixedBuyAmount) && fixedBuyAmount > 0) {
    quoteQuantity = Math.min(quoteQuantity, fixedBuyAmount);
  }
  quoteQuantity = capBuyQuoteByGrowingMax(quoteQuantity, symbolOptions, true);
  if (process.env.DEBUG == "true") {
    logToFile(
      "./logs/debug.log",
      `[SIM BUY] symbol=${symbol} quoteBalanceBefore=${quoteBalanceBefore} quoteUsed=${quoteQuantity} fixedBuyAmount=${Number.isFinite(fixedBuyAmount) ? fixedBuyAmount : "n/a"}`
    );
  }
  let baseQuantity = quoteQuantity / price;
  if (checkBeforePlacingOrder(baseQuantity, price, filter) === true) {
    let fee = simFeeOnBase(baseQuantity, symbolOptions.tradeFeePercentage);
    let baseQuantityWithoutFee = baseQuantity - fee;
    let lastTrade: Trade = {
      symbol: "",
      id: "",
      orderId: "",
      orderListID: 0,
      price: "",
      qty: "",
      quoteQty: "",
      commission: "",
      commissionAsset: "",
      time: 0,
      isBuyer: true,
      isMaker: true,
      isBestMatch: true,
    };
    let pnl = 0;
    const symbolKey = toSymbolKey(symbol);
    const th = exchangeOptions.tradeHistory?.[symbolKey];
    pnl = computeSimBuyClosePnl(th, price, symbolOptions.tradeFeePercentage);
    if ((th?.length ?? 0) >= 1) {
      lastTrade = th![th!.length - 1];
    }
    if (
      (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") &&
      !meetsTakeProfitLimitForAction(pnl, symbolOptions, "BUY")
    ) {
      return false;
    }
    // Prevent "minus trades" unless stop loss / idle force.
    if (!allowsForcedLossTrade(profit) && pnl < 0) {
      return false;
    }
    if (exchangeOptions.tradeHistory === undefined) {
      exchangeOptions.tradeHistory = {};
    }
    if (exchangeOptions.tradeHistory[symbolKey] === undefined) {
      exchangeOptions.tradeHistory[symbolKey] = [];
    }
    if (
      !allowsForcedLossTrade(profit) &&
      shouldBlockForProfitMinimum(pnl, "BUY", symbolOptions, profit, readForceSkip(toSymbolKey(symbol)) === true)
    ) {
      return false;
    }
    exchangeOptions.tradeHistory[symbolKey].push({
      symbol: symbolKey,
      id: "",
      orderId: "",
      orderListID: pnl,
      price: price.toString(),
      qty: baseQuantityWithoutFee.toString(),
      quoteQty: quoteQuantity.toString(),
      commission: fee.toString(),
      commissionAsset: symbol.split("/")[0],
      time: time,
      isBuyer: true,
      isMaker: true,
      isBestMatch: true,
      profit: profit,
    });
    if (process.env.SIMULATE === "true") {
      console.log(
        `[sim] BUY ${symbol} @ ${price.toFixed(2)} base≈${baseQuantityWithoutFee.toFixed(6)} (${profit}) | kauppoja yhteensä ${exchangeOptions.tradeHistory[symbolKey].length}`
      );
    }
    const baseCoin = symbol.split("/")[0];
    const quoteCoin = symbol.split("/")[1];
    balances[baseCoin].crypto = balances[baseCoin].crypto + baseQuantityWithoutFee;
    balances[quoteCoin].crypto = balances[quoteCoin].crypto - quoteQuantity;
    const sanitizedStartTime = simRunKeyFromStartTime(options.startTime);
    if (!shouldUsePartialTakeProfitClose(symbolOptions, profit, "BUY")) {
      if (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE") {
        noteFullTakeProfitClose(symbolOptions, profit, "BUY", pnl);
      }
      clearTakeProfitAfterTrade(symbol, symbolOptions);
    }
    queueSimTradeSnapshot(sanitizedStartTime, {
      symbol: symbol,
      direction: "BUY",
      quantity: baseQuantity,
      price: price,
      balances: balances,
      tradeHistory: exchangeOptions.tradeHistory,
    });
    if (profit === "STOP_LOSS") {
      markStopLossHit(symbolOptions, "BUY");
      registerStopLossClose(toSymbolKey(symbol), symbolOptions);
    }
    const skBuy = toSymbolKey(symbol);
    recordTradeFillForRateLimit(skBuy);
    if (profit === "BUY" || profit === "SELL" || profit === "SKIP") {
      recordEntryForRateLimit(skBuy);
    }
    // logger.flush();
    // logger.push("Time", (new Date(time)).toLocaleString());
    logger.push("Trade", "buy");
    logger.push("PNL", pnl);
    logger.push("Trigger", profit);
    // logger.push("Balances", balances);
    // logger.print();
    // logger.flush();
    return true;
  }
  return false;
};
