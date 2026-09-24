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

import fs from "fs";
import Binance from "node-binance-api";
import { loginDiscord } from "./Discord/discord";
import { listenForCandlesticks, Candlesticks } from "./Hoobot/Exchanges/Candlesticks";
import {
  ExchangeOptions,
  parseArgs,
  parseArgsSimulate,
  getLiveOptionsFilePath,
  getSimulateOptionsFilePath,
  loadSimulateSettingsDocument,
  getMinutesFromInterval,
  toSymbolKey,
  validateOptions,
  stripLegacyTakeProfitFields,
  sanitizeOptionsDocument,
  resolveProjectRelativePath,
  findProjectRoot,
  maskConfigSecretsForExport,
  preserveExchangeCredentialsFromLive,
  stripExchangeCredentialsForSimulatePersist,
  preserveLiveGrowingMaxOnBaselineExchanges,
  isMaskedExchangeCredential,
  type ConfigOptions,
  type SymbolOptions,
} from "./Hoobot/Utilities/Args";
import { createBinanceBalanceDataErrorLogBridge, assignCurrentBalances, storeBalances } from "./Hoobot/Exchanges/Balances";
import { consoleLogger } from "./Hoobot/Utilities/ConsoleLogger";
import { getFilters } from "./Hoobot/Exchanges/Filters";
import dotenv from "dotenv";
import { algorithmic } from "./Hoobot/Modes/Algorithmic";
import { seedTakeProfitRuntimeForAllSymbols, syncTakeProfitRuntimeFromConfig } from "./Hoobot/Indicators/Profit";
import { getTakeProfitRuntimeState } from "./Hoobot/Indicators/takeProfitPositionState";
import { checkLicenseValidity } from "./Hoobot/Utilities/License";
import { isTransientNetworkError } from "./Hoobot/Utilities/networkErrors";
import { Orderbook, getOrderbook, listenForOrderbooks } from "./Hoobot/Exchanges/Orderbook";
import { getTradeHistory, Trade, calculatePNLPercentageForLong, calculatePNLPercentageForShort } from "./Hoobot/Exchanges/Trades";
import { roundTripPnlAfterFees } from "./Hoobot/Trading/tradeGates";
import { hilow } from "./Hoobot/Modes/HiLow";
import { extreme } from "./Hoobot/Modes/Extreme";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Exchange } from "./Hoobot/Exchanges/Exchange";
import { logToFile } from "./Hoobot/Utilities/LogToFile";
import { NonKYC } from "./Hoobot/Exchanges/NonKYC/NonKYC";
import { Mexc } from "./Hoobot/Exchanges/Mexc/Mexc";
import { gridTrading } from "./Hoobot/Modes/Grid";
import { periodic } from "./Hoobot/Modes/Periodic";
import { getOpenOrders } from "./Hoobot/Exchanges/Orders";
import { getConsecutiveLossStatus, initConsecutiveLossGuard, lastCompletedRoundTripPnlPct } from "./Hoobot/Trading/consecutiveLossGuard";
import { registerDashboardRoutes } from "./api/dashboardRoutes";
import { registerHealthRoutes } from "./api/healthRoutes";
import { registerSettingsAdminRoutes } from "./api/settingsRoutes";
import { acquireLiveProcessLock } from "./Hoobot/Utilities/liveProcessLock";
import { getTargetTimestamp } from "./api/dashboardHelpers";
import { hasOpenPositionFromTradeHistory } from "./Hoobot/Trading/positionState";
import { fileURLToPath } from "url";
import express from "express";
import { createHash } from "crypto";
import { logger } from "./Hoobot/Utilities/Logger";
import { symbolFilters } from "./Hoobot/symbolFiltersStore";
import {
  runSimulationWithConfig,
  loadSimulationPreload,
  type SimulationApiResult,
  type SimulationProgress,
} from "./Hoobot/Simulation/runSimulationCore";
import {
  buildSimulationCheckpointFingerprint,
  defaultSimulationCheckpointPath,
  deleteSimulationCheckpointFile,
  readSimulationCheckpointFile,
} from "./Hoobot/Simulation/simulationCheckpoint";
import {
  deepMergeConfig,
  executeSimGrid,
  estimateGridVariantCount,
  recoverGridProgressFromBackup,
  validateGridPayload,
  type GridRunSummary,
  type GridRuntimeProgress,
} from "./Hoobot/Simulation/runSimGridCore";
import { installSimulationShutdownHandlers } from "./Hoobot/Simulation/simulationPersistence";
import { applySimulateProcessNice } from "./Hoobot/Utilities/simulateProcessGuard";
import { flattenLeafValues, extractSymbolPatchFromGridVariant, resolveSummaryApplyVariant } from "./Hoobot/Simulation/gridVariantCache";

export { symbolFilters, runSimulationWithConfig, loadSimulationPreload };
export type { SimulationApiResult, SimulationProgress };

// Get configuration options from command-line arguments and dotenv.
dotenv.config();

// Initialize Binance client

var options = process.env.SIMULATE === "true" ? parseArgsSimulate() : parseArgs();

const runExchange = async (exchange: Exchange, discord: any, exchangeOptions: ExchangeOptions) => {
  exchangeOptions.balances = await assignCurrentBalances(exchange, exchangeOptions);
  storeBalances(exchange, exchangeOptions.balances);
  const candlesticksToPreload = 1000;
  const symbolCandlesticks: Candlesticks = {};
  if (exchangeOptions.mode === "algorithmic") {
    logger.info(`Start running exchange ${exchangeOptions.name} on algorithmic mode.`);
    if (Array.isArray(exchangeOptions.symbols)) {
      if (exchangeOptions.orderbooks === undefined) {
        exchangeOptions.orderbooks = {};
      }
      for (const symbolOptions of exchangeOptions.symbols) {
        if (symbolOptions.enabled === false) continue;
        exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = await getOrderbook(
          exchange,
          symbolOptions.name
        );
        symbolFilters[toSymbolKey(symbolOptions.name)] = await getFilters(exchange, symbolOptions.name);

        const symbolKey = toSymbolKey(symbolOptions.name);
        if (exchangeOptions.tradeHistory === undefined) {
          exchangeOptions.tradeHistory = {};
        }
        exchangeOptions.tradeHistory[symbolKey] = await getTradeHistory(exchange, symbolOptions.name);
        const trades = exchangeOptions.tradeHistory[symbolKey];
        if (Array.isArray(trades) && trades.length > 0) {
          const last: Trade = trades[trades.length - 1];
          const timeStr = new Date(last.time).toLocaleString("fi-FI");
          const side = last.isBuyer ? "BUY" : "SELL";
          console.log(
            `[${symbolOptions.name}] Viimeisin kauppa: ${side} ${last.qty} @ ${last.price} (${timeStr})`
          );
        }

        listenForOrderbooks(exchange, symbolOptions.name, (symbol: string, orderbook: Orderbook) => {
          if (exchangeOptions.orderbooks === undefined) {
            exchangeOptions.orderbooks = {};
          }
          if (
            exchangeOptions.orderbooks !== undefined &&
            exchangeOptions.orderbooks[toSymbolKey(symbol)] === undefined
          ) {
            exchangeOptions.orderbooks[toSymbolKey(symbol)] = {
              bids: {},
              asks: {},
            };
          }
          exchangeOptions.orderbooks[toSymbolKey(symbol)] = orderbook;
        });
        listenForCandlesticks(
          exchange,
          symbolOptions.name,
          symbolOptions.timeframes,
          symbolCandlesticks,
          candlesticksToPreload,
          symbolOptions,
          async (candlesticks: Candlesticks) => {
            const logger = consoleLogger();
            try {
              await algorithmic(
                discord,
                exchange,
                logger,
                symbolOptions.name,
                candlesticks,
                options,
                exchangeOptions,
                symbolOptions
              );
            } catch (err) {
              logToFile("./logs/error.log", JSON.stringify({ context: "algorithmic", symbol: symbolOptions.name, err }, null, 4));
              console.error(`algorithmic ${symbolOptions.name}:`, err);
            }
          }
        );
      }
    }
  } else if (exchangeOptions.mode === "hilow") {
    console.log(`Start running exchange  ${exchangeOptions.name} on hilow mode.`);
    for (const symbolOptions of exchangeOptions.symbols) {
      if (symbolOptions.enabled === false) continue;
      exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = await getOrderbook(
        exchange,
        symbolOptions.name
      );
      symbolFilters[toSymbolKey(symbolOptions.name)] = await getFilters(exchange, symbolOptions.name);
      listenForOrderbooks(exchange, symbolOptions.name, (_symbol: string, orderbook: Orderbook) => {
        if (exchangeOptions.orderbooks === undefined) {
          exchangeOptions.orderbooks = {};
        }
        if (
          exchangeOptions.orderbooks !== undefined &&
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] === undefined
        ) {
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = {
            bids: {},
            asks: {},
          };
        }
        exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = orderbook;
        const logger = consoleLogger();
        hilow(discord, exchange, logger, symbolOptions.name, options, exchangeOptions, symbolOptions);
      });
    }
  } else if (exchangeOptions.mode === "extreme") {
    console.log(`Start running exchange  ${exchangeOptions.name} on extreme mode.`);
    for (const symbolOptions of exchangeOptions.symbols) {
      if (symbolOptions.enabled === false) continue;
      exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = await getOrderbook(
        exchange,
        symbolOptions.name
      );
      symbolFilters[toSymbolKey(symbolOptions.name)] = await getFilters(exchange, symbolOptions.name);
      listenForOrderbooks(exchange, symbolOptions.name, (_symbol: string, orderbook: Orderbook) => {
        if (exchangeOptions.orderbooks === undefined) {
          exchangeOptions.orderbooks = {};
        }
        if (
          exchangeOptions.orderbooks !== undefined &&
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] === undefined
        ) {
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = {
            bids: {},
            asks: {},
          };
        }
        exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = orderbook;
        const logger = consoleLogger();
        extreme(discord, exchange, logger, symbolOptions.name, options, exchangeOptions, symbolOptions);
      });
    }
  } else if (exchangeOptions.mode === "periodic") {
    console.log(`Start running exchange  ${exchangeOptions.name} on periodic mode.`);
    for (const symbolOptions of exchangeOptions.symbols) {
      if (symbolOptions.enabled === false) continue;
      exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = await getOrderbook(
        exchange,
        symbolOptions.name
      );
      symbolFilters[toSymbolKey(symbolOptions.name)] = await getFilters(exchange, symbolOptions.name);
      listenForOrderbooks(exchange, symbolOptions.name, (_symbol: string, orderbook: Orderbook) => {
        if (exchangeOptions.orderbooks === undefined) {
          exchangeOptions.orderbooks = {};
        }
        if (
          exchangeOptions.orderbooks !== undefined &&
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] === undefined
        ) {
          exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = {
            bids: {},
            asks: {},
          };
        }
        exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = orderbook;
        const logger = consoleLogger();
        periodic(discord, exchange, logger, symbolOptions.name, options, exchangeOptions, symbolOptions);
      });
    }
  } else if (exchangeOptions.mode === "grid") {
    console.log(`Start running exchange ${exchangeOptions.name} on grid trading mode.`);
    if (Array.isArray(exchangeOptions.symbols)) {
      for (const symbolOptions of exchangeOptions.symbols) {
        if (symbolOptions.enabled === false) continue;
        exchangeOptions.orderbooks[toSymbolKey(symbolOptions.name)] = await getOrderbook(
          exchange,
          symbolOptions.name
        );
        symbolFilters[toSymbolKey(symbolOptions.name)] = await getFilters(exchange, symbolOptions.name);
        listenForOrderbooks(exchange, symbolOptions.name, (symbol: string, orderbook: Orderbook) => {
          if (exchangeOptions.orderbooks === undefined) {
            exchangeOptions.orderbooks = {};
          }
          if (
            exchangeOptions.orderbooks !== undefined &&
            exchangeOptions.orderbooks[toSymbolKey(symbol)] === undefined
          ) {
            exchangeOptions.orderbooks[toSymbolKey(symbol)] = {
              bids: {},
              asks: {},
            };
          }
          exchangeOptions.orderbooks[toSymbolKey(symbol)] = orderbook;
        });
        // listenForTrades(exchange, symbolOptions.name, async (trade: Trade) => {
        //   let msg = "```";
        //   msg += `Order executed: ${trade.symbol}\r\n`;
        //   msg += `${trade.isBuyer === true ? "Buy" : "Sell"} ID: ${trade.orderId}\r\n`;
        //   msg += `Price: ${trade.price}\r\n`;
        //   msg += `Qty: ${trade.qty}\r\n`;
        //   msg += `Time now ${new Date().toLocaleString("fi-fi")}\r\n`;
        //   msg += "```";
        //   sendMessageToChannel(discord, options.discord.channelId!, msg);
        // });
        listenForCandlesticks(
          exchange,
          symbolOptions.name,
          symbolOptions.timeframes,
          symbolCandlesticks,
          candlesticksToPreload,
          symbolOptions,
          async (candlesticks: Candlesticks) => {
            const logger = consoleLogger();
            await gridTrading(
              discord,
              exchange,
              logger,
              symbolOptions.name,
              candlesticks,
              options,
              exchangeOptions,
              symbolOptions
            );
          }
        );
      }
    }
  }
};

/** Binance REST HTTP-timeout (ms); erillinen recvWindow:sta. Nosta jos ESOCKETTIMEDOUT jatkuu hitaalla verkolla. */
const DEFAULT_BINANCE_HTTP_REQUEST_TIMEOUT_MS = 300000;

const startBinance = async (
  exchangeOptions: ExchangeOptions,
  opts?: { silent?: boolean }
): Promise<Exchange> => {
  const exchange = new Binance();
  const httpMs =
    typeof exchangeOptions.binanceHttpRequestTimeoutMs === "number" &&
    exchangeOptions.binanceHttpRequestTimeoutMs > 0
      ? exchangeOptions.binanceHttpRequestTimeoutMs
      : DEFAULT_BINANCE_HTTP_REQUEST_TIMEOUT_MS;
  exchange.options({
    APIKEY: exchangeOptions.key,
    APISECRET: exchangeOptions.secret,
    useServerTime: true,
    recvWindow: 60000,
    /** Binance API recvWindow; HTTP-pyynnön timeout erikseen (node-binance-api + scripts/apply-node-binance-http-timeout.cjs) */
    httpRequestTimeout: httpMs,
    family: 4,
    /** Kun WS-account ilmoitus puuttuu balances[], kirjasto lokee balanceData error — haetaan saldot RESTillä (rajoitettu välein). */
    log: createBinanceBalanceDataErrorLogBridge(exchange, exchangeOptions),
  });
  try {
    const binanceAny = exchange as any;
    if (typeof binanceAny.useServerTime === "function") {
      await binanceAny.useServerTime();
    }
  } catch (err) {
    console.warn("Binance serveriajan synkronointi epäonnistui käynnistyksessä:", err);
  }
  if (!opts?.silent) {
    console.log("Started Binance");
  }
  return exchange;
};

const startNonKYC = async (
  exchangeOptions: ExchangeOptions,
  opts?: { silent?: boolean }
): Promise<Exchange> => {
  if (exchangeOptions.forceStopOnDisconnect === undefined) {
    exchangeOptions.forceStopOnDisconnect = false;
  }
  const exchange = new NonKYC(exchangeOptions.key, exchangeOptions.secret, exchangeOptions.forceStopOnDisconnect);
  await exchange.waitConnect();
  if (!opts?.silent) {
    console.log("Started NonKYC");
  }
  return exchange;
};

const startMexc = async (
  exchangeOptions: ExchangeOptions,
  opts?: { silent?: boolean }
): Promise<Exchange> => {
  if (exchangeOptions.forceStopOnDisconnect === undefined) {
    exchangeOptions.forceStopOnDisconnect = false;
  }
  const exchange = new Mexc({ key: exchangeOptions.key, secret: exchangeOptions.secret });
  await exchange.waitConnect();
  if (!opts?.silent) {
    console.log("Started Mexc");
  }
  return exchange;
};

const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

type PersistedSimulationResult = {
  savedAt: string;
  result: SimulationApiResult;
  /** Grid-ajon pohja-asetukset (maskatut avaimet), kun tulos on peräisin gridistä. */
  baselineConfig?: ConfigOptions;
};

type SimSymbolTradeStats = {
  name: string;
  trades: number;
  takeProfits: number;
  stopLosses: number;
  stopLossSells: number;
  stopLossBuys: number;
  sells: number;
  buys: number;
  holds: number;
};

type SimVariantTradeStats = {
  trades: number;
  takeProfits: number;
  stopLosses: number;
  stopLossSells: number;
  stopLossBuys: number;
  sells: number;
  buys: number;
  holds: number;
  symbols: SimSymbolTradeStats[];
};

const aggregateTradeStatsFromResult = (r: SimulationApiResult): SimVariantTradeStats | undefined => {
  if (!r.ok || !Array.isArray(r.symbols)) return undefined;
  const symbols: SimSymbolTradeStats[] = r.symbols.map((s) => ({
    name: String(s.name ?? ""),
    trades: Number(s.trades) || 0,
    takeProfits: Number(s.takeProfits) || 0,
    stopLosses: Number(s.stopLosses) || 0,
    stopLossSells: Number(s.stopLossSells) || 0,
    stopLossBuys: Number(s.stopLossBuys) || 0,
    sells: Number(s.sells) || 0,
    buys: Number(s.buys) || 0,
    holds: Number(s.holds) || 0,
  }));
  return symbols.reduce<SimVariantTradeStats>(
    (acc, s) => {
      acc.trades += s.trades;
      acc.takeProfits += s.takeProfits;
      acc.stopLosses += s.stopLosses;
      acc.stopLossSells += s.stopLossSells;
      acc.stopLossBuys += s.stopLossBuys;
      acc.sells += s.sells;
      acc.buys += s.buys;
      acc.holds += s.holds;
      return acc;
    },
    {
      trades: 0,
      takeProfits: 0,
      stopLosses: 0,
      stopLossSells: 0,
      stopLossBuys: 0,
      sells: 0,
      buys: 0,
      holds: 0,
      symbols,
    }
  );
};

type SimulationRunSummaryRow = {
  source: "grid-results" | "grid-progress" | "grid-last" | "simulate-last" | "grid-cache";
  file: string;
  savedAt?: string;
  gridPath?: string;
  variantIndex?: number;
  roi: number;
  roiPercent: string;
  startingBalance: number;
  finalPortfolio: number;
  candleRows: number;
  variant?: unknown;
  values: Record<string, unknown>;
  tradeStats?: SimVariantTradeStats;
  /** simulate-last + tallennettu baselineConfig — koko exchanges → live (paikallinen sim-istunto). */
  hasPersistedBaseline?: boolean;
  /** Grid baseline (variantti #1): simulation/baseline-options-*.json */
  baselineOptionsSnapshotFile?: string;
  /** Grid baseline — Koko baseline → live -nappi */
  hasGridBaselineSnapshot?: boolean;
  /** API: voidaanko rivin parametrit siirtää (Liveen / simulaatiossa). */
  canApplyVariant?: boolean;
  /** API: normalisoitu variantti siirtoa varten. */
  applyVariant?: unknown;
  /** API: voidaanko koko baseline exchanges → live. */
  canApplyBaseline?: boolean;
};

const hoobot = async () => {
  try {
    seedTakeProfitRuntimeForAllSymbols(options);
    initConsecutiveLossGuard();
    if (await checkLicenseValidity(options.license)) {
      console.log("License key is valid. Enjoy the trading with Hoobot!");
    } else {
      console.log(
        "Invalid license key. Please purchase a valid license. Contact toni.lukkaroinen@hoosat.fi to purchase Hoobot Hoobot. There are preventions to notice this if you remove this check."
      );
    }
    let discord: Awaited<ReturnType<typeof loginDiscord>> = undefined;
    const exchanges: Exchange[] = [];
    if (options.discord?.enabled === true && process.env.SIMULATE !== "true") {
      try {
        discord = await loginDiscord(exchanges, options);
      } catch (error) {
        console.error("Discord login failed — jatketaan ilman Discordia:", error);
      }
    } else if (options.discord?.enabled === true && process.env.SIMULATE === "true") {
      console.log("Discord ohitetaan simulaatio-istunnossa (SIMULATE=true) — ei WebSocket-yhteyttä Discordiin.");
    }
    for (var exchangeOptions of options.exchanges) {
      exchangeOptions.dryRun = options.dryRun ?? false;
      if (exchangeOptions.name === "nonkyc") {
        const setupNonKYC = async (exchangeOptions: any, discord: any): Promise<Exchange> => {
          exchangeOptions.socket = await startNonKYC(exchangeOptions);
          exchangeOptions.socket.on("try-to-reconnect", async () => {
            console.log("Trying to reconnect");
            exchangeOptions.socket = await setupNonKYC(exchangeOptions, discord);
            runExchange(exchangeOptions.socket, discord, exchangeOptions);
          });
          return exchangeOptions.socket;
        };
        exchangeOptions.socket = await setupNonKYC(exchangeOptions, discord);
        exchanges.push(exchangeOptions.socket);
      }
      if (exchangeOptions.name === "mexc") {
        exchangeOptions.socket = await startMexc(exchangeOptions);
        exchanges.push(exchangeOptions.socket);
      }
      if (exchangeOptions.name === "binance") {
        exchangeOptions.socket = await startBinance(exchangeOptions);
        exchanges.push(exchangeOptions.socket);
      }
      if (exchangeOptions.socket !== undefined) {
        runExchange(exchangeOptions.socket, discord, exchangeOptions);
        await delay(1000);
      }
    }
  } catch (error) {
    logToFile("./logs/error.log", JSON.stringify(error, null, 4));
    console.error(JSON.stringify(error, null, 4));
  }
};

// --- PNL helpers for Dashboard ---

const getHistoricalTradesForDuration = async (
  exchange: Exchange,
  symbol: string,
  duration: string
): Promise<Trade[]> => {
  const tradeHistory: Trade[] = await getTradeHistory(exchange, symbol);
  const targetTimestamp: number = getTargetTimestamp(duration.toUpperCase());
  const tradesInDuration: Trade[] = tradeHistory.filter((trade) => trade.time / 1000 >= targetTimestamp);
  const tradesBeforeDuration: Trade[] = tradeHistory.filter((trade) => trade.time / 1000 < targetTimestamp);
  const previousTradeBeforeDuration = tradesBeforeDuration[tradesBeforeDuration.length - 1];
  if (previousTradeBeforeDuration === undefined) {
    return tradesInDuration;
  }
  return [previousTradeBeforeDuration, ...tradesInDuration];
};

// Prevent hammering exchange REST endpoints from the Dashboard.
const pnlCacheByKey: Record<string, { at: number; data: unknown }> = {};
const PNL_CACHE_MS = 15000;
const priceChartCacheByKey: Record<string, { at: number; data: unknown }> = {};
const PRICE_CHART_CACHE_MS = 30000;

const resolveDashboardExchange = async (
  exchangeName: string
): Promise<
  | { exchange: Exchange; exchangeOptions: ExchangeOptions }
  | { error: string; status: number }
> => {
  const exchangeOptions = options.exchanges.find((e) => e.name === exchangeName);
  if (!exchangeOptions) {
    return { error: `Exchange '${exchangeName}' not found in settings`, status: 400 };
  }
  let exchange: Exchange;
  if (exchangeOptions.socket) {
    exchange = exchangeOptions.socket;
  } else if (exchangeOptions.name === "binance") {
    exchange = await startBinance(exchangeOptions, { silent: true });
  } else if (exchangeOptions.name === "nonkyc") {
    exchange = await startNonKYC(exchangeOptions, { silent: true });
  } else if (exchangeOptions.name === "mexc") {
    exchange = await startMexc(exchangeOptions, { silent: true });
  } else {
    return { error: `Exchange '${exchangeOptions.name}' not supported for dashboard`, status: 400 };
  }
  return { exchange, exchangeOptions };
};

/** Kryptot-sivu: CoinGecko ID per näytettävä ticker. */
const CRYPTO_COINGECKO_IDS: Record<string, string> = {
  KAS: "kaspa",
  RXD: "radiant",
  ALEO: "aleo",
};
let cryptoPricesCache: { at: number; data: { RAW: Record<string, Record<string, { PRICE: number; CHANGEPCT24HOUR: number }>> } } | null =
  null;
const CRYPTO_PRICES_CACHE_MS = 55_000;

const simulate = async (): Promise<SimulationApiResult> => {
  try {
    const cfg = validateOptions(JSON.parse(JSON.stringify(parseArgsSimulate())) as ConfigOptions);
    return await runSimulationWithConfig(cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("simulate:", e);
    return { ok: false, error: msg };
  }
};

const stopHoobot = () => {
  if (!options.exchanges?.length) return;
  console.log("Exchanges to shut down %d", options.exchanges.length);
  for (var i = 0; i < options.exchanges.length; i++) {
    const socket = options.exchanges[i].socket;
    if (!socket) continue;
    console.log(
      "Symbols to to shut down %d in the exchange %s",
      options.exchanges[i].symbols?.length ?? 0,
      options.exchanges[i].name
    );
    if (options.exchanges[i].name == "nonkyc") {
      for (var x = 0; x < (options.exchanges[i].symbols?.length ?? 0); x++) {
        for (var y = 0; y < (options.exchanges[i].symbols[x].timeframes?.length ?? 0); y++) {
          (socket as NonKYC).unsubscribeCandles(
            options.exchanges[i].symbols[x].name,
            getMinutesFromInterval(options.exchanges[i].symbols[x].timeframes[y])
          );
        }
        (socket as NonKYC).unsubscribeOrderbook(options.exchanges[i].symbols[x].name);
        (socket as NonKYC).unsubscribeTrades(options.exchanges[i].symbols[x].name);
        (socket as NonKYC).unsubscribeTicker(options.exchanges[i].symbols[x].name);
        (socket as NonKYC).unsubscribeReports();
      }
      (socket as NonKYC).disconnect();
    } else if (options.exchanges[i].name == "binance") {
      (socket as Binance).websockets?.terminate();
    }
  }
};

const webServer = async () => {
  const app = express();
  const isSimulateInstance = process.env.SIMULATE === "true";
  if (isSimulateInstance) {
    applySimulateProcessNice();
    installSimulationShutdownHandlers();
  }
  const PORT = process.env.PORT || (isSimulateInstance ? 5657 : 5656);
  const simulationDir = path.join(findProjectRoot(), "simulation");
  const simulationCacheDir = path.join(simulationDir, "cache");
  const simulationSingleCacheDir = path.join(simulationCacheDir, "single");
  const simulationGridCacheDir = path.join(simulationCacheDir, "grid");
  const simulateLastResultFile = path.join(simulationDir, "simulate-last-result.json");
  const gridLastSummaryFile = path.join(simulationDir, "grid-last-summary.json");
  const liveOptionsFilename = getLiveOptionsFilePath();
  const simulateOptionsFilename = getSimulateOptionsFilePath();
  /** Live aina hoobot-options.json; simulaatio-istunto oma tiedosto (+ fallback lukemisessa liveen). */
  const optionsFilename = isSimulateInstance ? simulateOptionsFilename : liveOptionsFilename;

  if (isSimulateInstance && existsSync(simulationDir)) {
    const recovered = recoverGridProgressFromBackup(simulationDir);
    if (recovered.recovered) {
      logger.info(
        `Grid-progress palautettu backupista ${recovered.fromFile ?? ""} (${recovered.okResults} onnistunutta varianttia).`
      );
    }
  }

  const effectiveSettingsReadPath = (): string => {
    if (!isSimulateInstance) return optionsFilename;
    if (fs.existsSync(optionsFilename)) return optionsFilename;
    if (fs.existsSync(liveOptionsFilename)) return liveOptionsFilename;
    return optionsFilename;
  };

  const effectiveSettingsMergePath = (): string => {
    return effectiveSettingsReadPath();
  };

  type SimToLiveSymbolMergePolicy = {
    patchAllowPaths?: string[];
    preserveLivePathsExtra?: string[];
  };

  const isCfgPlainRecord = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === "object" && !Array.isArray(x);

  const readOptionalDotPaths = (field: unknown): string[] | undefined => {
    if (!Array.isArray(field)) return undefined;
    const out: string[] = [];
    for (const item of field) {
      if (typeof item !== "string") continue;
      const t = item.trim().replace(/\s+/g, "");
      if (!t) continue;
      out.push(t.split(/\.+/).filter(Boolean).join("."));
    }
    return out.length > 0 ? out : undefined;
  };

  const readSimToLiveMergePolicy = (liveDocRoot: Record<string, unknown>): SimToLiveSymbolMergePolicy => ({
    patchAllowPaths: readOptionalDotPaths(liveDocRoot.simPatchMergeAllowPaths),
    preserveLivePathsExtra: readOptionalDotPaths(liveDocRoot.simPreservePathsOnLiveMerge),
  });

  const cloneJsonValue = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  const writeJsonFileAtomic = (filePath: string, doc: unknown): void => {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  };

  const valueAtDotPath = (root: unknown, dotted: string): unknown => {
    const parts = dotted.split(".").filter((p) => p.length > 0);
    if (parts.length === 0) return undefined;
    let cur: unknown = root;
    for (const p of parts) {
      if (!isCfgPlainRecord(cur)) return undefined;
      cur = cur[p];
      if (cur === undefined) return undefined;
    }
    return cur;
  };

  const assignAtDotPath = (mutRoot: Record<string, unknown>, dotted: string, value: unknown): void => {
    const parts = dotted.split(".").filter((p) => p.length > 0);
    if (parts.length === 0) return;
    let cur: Record<string, unknown> = mutRoot;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      let branch = cur[k];
      if (branch === null || !isCfgPlainRecord(branch)) {
        branch = {};
        cur[k] = branch;
      }
      cur = branch as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value as never;
  };

  /**
   * Yhdistä sim/grid-PATCH livessä olevaan symboliin: **ei korvata koko symbolia** default-tilassa syvätäydennyksellä.
   * `hoobot-options` root: `simPatchMergeAllowPaths` = vain PATCHin nämät polut päivittyvät; `simPreservePathsOnLiveMerge`
   * = nämä PATHit palautetaan aina live-symbolista PATCHin jälkeen. Ajonaikaiset kentät (grid, tilaukset…) yhä livestä.
   */
  const mergeIncomingSymbolPreserveLiveRuntime = (
    incoming: Record<string, unknown>,
    existing: SymbolOptions | undefined,
    policy?: SimToLiveSymbolMergePolicy
  ): Record<string, unknown> => {
    if (!existing) return { ...incoming };

    const allowPaths = policy?.patchAllowPaths;
    const preserveExtra = policy?.preserveLivePathsExtra;

    const existingAsRecord = (s: SymbolOptions): Record<string, unknown> =>
      cloneJsonValue(s) as unknown as Record<string, unknown>;

    let merged: Record<string, unknown>;
    if (allowPaths && allowPaths.length > 0) {
      merged = existingAsRecord(existing);
      for (const pth of allowPaths) {
        const v = valueAtDotPath(incoming, pth);
        if (v !== undefined) assignAtDotPath(merged, pth, cloneJsonValue(v));
      }
    } else {
      const baseSnap = existingAsRecord(existing);
      merged = deepMergeConfig(baseSnap, incoming) as Record<string, unknown>;
    }

    if (preserveExtra && preserveExtra.length > 0) {
      const liveSnap = existingAsRecord(existing);
      for (const pth of preserveExtra) {
        const v = valueAtDotPath(liveSnap, pth);
        if (v !== undefined) assignAtDotPath(merged, pth, cloneJsonValue(v));
      }
    }

    const ex = existingAsRecord(existing);

    const preserveTop = [
      "currentOrder",
      "grid",
      "periodicTime",
      "consecutiveQuantity",
      "consecutiveDirection",
      "consecutivePreviousDirection",
      "consecutiveNextTrade",
      "consecutiveTradeAllowed",
      "noPreviousTradeCheck",
      "minimumTimeSinceLastTrade",
    ] as const;
    for (const k of preserveTop) {
      if (ex[k] !== undefined) merged[k] = ex[k];
    }
    const oldTrend = ex.trend as Record<string, unknown> | undefined;
    const newTrend = merged.trend as Record<string, unknown> | undefined;
    if (oldTrend && newTrend != null && typeof newTrend === "object") {
      merged.trend = { ...newTrend, current: oldTrend.current ?? newTrend.current };
    }
    const oldTp = ex.takeProfit as Record<string, unknown> | undefined;
    const newTp = merged.takeProfit as Record<string, unknown> | undefined;
    if (oldTp || newTp) {
      merged.takeProfit = stripLegacyTakeProfitFields({ ...(oldTp || {}), ...(newTp || {}) });
      const cur = merged.takeProfit as Record<string, unknown>;
      if (existing.takeProfit?.current != null) cur.current = existing.takeProfit.current;
    }
    const oldSl = ex.stopLoss as Record<string, unknown> | undefined;
    const newSl = merged.stopLoss as Record<string, unknown> | undefined;
    if (oldSl || newSl) {
      merged.stopLoss = { ...(oldSl || {}), ...(newSl || {}) };
      const sl = merged.stopLoss as Record<string, unknown>;
      if (existing.stopLoss?.hit !== undefined) sl.hit = existing.stopLoss.hit;
    }
    const oldTpb = ex.takeProfitBuy as Record<string, unknown> | undefined;
    const newTpb = merged.takeProfitBuy as Record<string, unknown> | undefined;
    if (oldTpb || newTpb) {
      merged.takeProfitBuy = stripLegacyTakeProfitFields({ ...(oldTpb || {}), ...(newTpb || {}) });
      const curB = merged.takeProfitBuy as Record<string, unknown>;
      if (existing.takeProfitBuy?.current != null) curB.current = existing.takeProfitBuy.current;
    }
    const oldSlB = ex.stopLossBuy as Record<string, unknown> | undefined;
    const newSlB = merged.stopLossBuy as Record<string, unknown> | undefined;
    if (oldSlB || newSlB) {
      merged.stopLossBuy = { ...(oldSlB || {}), ...(newSlB || {}) };
      const slb = merged.stopLossBuy as Record<string, unknown>;
      if (existing.stopLossBuy && "hit" in existing.stopLossBuy && existing.stopLossBuy.hit !== undefined) {
        slb.hit = (existing.stopLossBuy as { hit?: boolean }).hit;
      }
    }
    /** Grid-sim PATCH ei välttämättä sisällä näitä — ilman säilytys liveltä puuttuu mm. `timeframes` → listenForCandlesticks kaatuu. */
    if ((!Array.isArray(merged.timeframes) || merged.timeframes.length === 0) && Array.isArray(ex.timeframes)) {
      merged.timeframes = ex.timeframes as unknown[];
    }
    if (merged.minimumBuy === undefined && ex.minimumBuy !== undefined) merged.minimumBuy = ex.minimumBuy;
    if (merged.minimumSell === undefined && ex.minimumSell !== undefined) merged.minimumSell = ex.minimumSell;
    if (merged.minimumVolume === undefined && ex.minimumVolume !== undefined) merged.minimumVolume = ex.minimumVolume;
    const mergedSym = { ...existing, ...(merged as object) } as SymbolOptions;
    syncTakeProfitRuntimeFromConfig(mergedSym);
    return merged;
  };

  /** Yhteinen siirto: kirjoita hoobot-options -tiedostoon (polku annettu) yhteenvetovariantin patch. */
  const applySummaryVariantToHoobotJsonFile = (
    targetFilePath: string,
    body: {
      exchangeName?: string;
      targetSymbolName?: string;
      applyToAll?: boolean;
      variant?: unknown;
      flatValues?: Record<string, unknown>;
      values?: Record<string, unknown>;
    }
  ):
    | { ok: true; appliedSymbols: string[]; basename: string }
    | { ok: false; status: number; error: string } => {
    const flatValues = body.flatValues ?? body.values;
    const resolved = resolveSummaryApplyVariant(body.variant, flatValues);
    if (!resolved.canApply || resolved.applyVariant == null) {
      return {
        ok: false,
        status: 400,
        error: "Puuttuu variantti tai ei symbolipatchia (exchanges → … → symbols[0]).",
      };
    }
    if (!fs.existsSync(targetFilePath)) {
      return {
        ok: false,
        status: 400,
        error: "Asetustiedostoa ei löydy: " + targetFilePath,
      };
    }
    try {
      const rawLive = fs.readFileSync(targetFilePath, "utf-8");
      const liveDoc = (rawLive ? JSON.parse(rawLive) : {}) as Record<string, unknown>;
      const simToLivePol = readSimToLiveMergePolicy(liveDoc);
      const exchanges = liveDoc.exchanges as ExchangeOptions[] | undefined;
      if (!Array.isArray(exchanges) || exchanges.length === 0) {
        return { ok: false, status: 400, error: "Konfigissa ei ole pörssejä." };
      }
      const wantEx = (body.exchangeName ?? "").toString().trim();
      let exIdx = wantEx ? exchanges.findIndex((e) => e && e.name === wantEx) : 0;
      if (exIdx < 0 && wantEx) {
        return {
          ok: false,
          status: 400,
          error: `Pörssiä "${wantEx}" ei löydy asetuksista.`,
        };
      }
      if (exIdx < 0) exIdx = 0;
      const ex = exchanges[exIdx];
      if (!ex || !Array.isArray(ex.symbols)) {
        return { ok: false, status: 400, error: "Pörssillä ei ole symbolilistaa." };
      }
      const syms = [...ex.symbols];
      const applyToAll = body.applyToAll === true;
      const targetName = (body.targetSymbolName ?? "").toString().trim();
      if (!applyToAll && !targetName) {
        return { ok: false, status: 400, error: "Valitse kohdepari tai käytä Siirrä kaikkiin." };
      }
      const targetNames = applyToAll
        ? syms.map((s) => (s && s.name ? String(s.name) : "")).filter(Boolean)
        : [targetName];
      if (targetNames.length === 0) {
        return { ok: false, status: 400, error: "Ei kohdesymboleja." };
      }
      const applied: string[] = [];
      for (const nm of targetNames) {
        const sIdx = syms.findIndex((s) => s && s.name === nm);
        if (sIdx < 0) {
          return {
            ok: false,
            status: 400,
            error: `Symbolia "${nm}" ei löydy asetuksissa.`,
          };
        }
        const patch =
          extractSymbolPatchFromGridVariant(resolved.applyVariant, nm) ??
          extractSymbolPatchFromGridVariant(resolved.applyVariant);
        if (!patch || Object.keys(patch).length === 0) {
          if (applyToAll) continue;
          return {
            ok: false,
            status: 400,
            error: `Variantissa ei ole parametreja parille "${nm}".`,
          };
        }
        const existingSym = syms[sIdx];
        const incoming = { ...patch, name: nm } as Record<string, unknown>;
        delete incoming.growingMax;
        const merged = mergeIncomingSymbolPreserveLiveRuntime(incoming, existingSym, simToLivePol);
        syms[sIdx] = merged as unknown as SymbolOptions;
        syncTakeProfitRuntimeFromConfig(syms[sIdx]);
        applied.push(nm);
      }
      if (applied.length === 0) {
        return {
          ok: false,
          status: 400,
          error: applyToAll
            ? "Yhtään kohdeparia ei voitu yhdistää variantin parametreilla."
            : "Kohdeparia ei voitu yhdistää.",
        };
      }
      ex.symbols = syms as SymbolOptions[];
      writeJsonFileAtomic(
        targetFilePath,
        sanitizeOptionsDocument(liveDoc as ConfigOptions)
      );
      return { ok: true, appliedSymbols: applied, basename: path.basename(targetFilePath) };
    } catch (e) {
      console.error("applySummaryVariantToHoobotJsonFile:", e);
      return { ok: false, status: 500, error: "Siirto epäonnistui (tiedoston käsittely)." };
    }
  };

  /** Baseline-snapshotin symbolit yhdistetään liveen (koko symboli, ei vain grid-patch). */
  const applyBaselineSymbolsToHoobotJsonFile = (
    targetFilePath: string,
    baselineExchanges: ExchangeOptions[],
    body: {
      exchangeName?: string;
      targetSymbolName?: string;
      applyToAll?: boolean;
    }
  ):
    | { ok: true; appliedSymbols: string[]; basename: string }
    | { ok: false; status: number; error: string } => {
    if (!baselineExchanges.length) {
      return { ok: false, status: 400, error: "Baselinesta ei löytynyt pörssejä." };
    }
    if (!fs.existsSync(targetFilePath)) {
      return {
        ok: false,
        status: 400,
        error: "Asetustiedostoa ei löydy: " + targetFilePath,
      };
    }
    try {
      const rawLive = fs.readFileSync(targetFilePath, "utf-8");
      const liveDoc = (rawLive ? JSON.parse(rawLive) : {}) as Record<string, unknown>;
      const simToLivePol = readSimToLiveMergePolicy(liveDoc);
      const exchanges = liveDoc.exchanges as ExchangeOptions[] | undefined;
      if (!Array.isArray(exchanges) || exchanges.length === 0) {
        return { ok: false, status: 400, error: "Konfigissa ei ole pörssejä." };
      }
      const wantEx = (body.exchangeName ?? "").toString().trim();
      let exIdx = wantEx ? exchanges.findIndex((e) => e && e.name === wantEx) : 0;
      if (exIdx < 0 && wantEx) {
        return {
          ok: false,
          status: 400,
          error: `Pörssiä "${wantEx}" ei löydy live-asetuksista.`,
        };
      }
      if (exIdx < 0) exIdx = 0;
      const ex = exchanges[exIdx];
      if (!ex || !Array.isArray(ex.symbols)) {
        return { ok: false, status: 400, error: "Pörssillä ei ole symbolilistaa." };
      }
      const baselineEx =
        (wantEx ? baselineExchanges.find((e) => e && e.name === wantEx) : undefined) ??
        baselineExchanges[0];
      if (!baselineEx || !Array.isArray(baselineEx.symbols) || baselineEx.symbols.length === 0) {
        return { ok: false, status: 400, error: "Baseline-pörssillä ei ole symboleja." };
      }
      const baselineByName = new Map<string, SymbolOptions>();
      for (const s of baselineEx.symbols) {
        if (s?.name) baselineByName.set(String(s.name), s);
      }
      const syms = [...ex.symbols];
      const applyToAll = body.applyToAll === true;
      const targetName = (body.targetSymbolName ?? "").toString().trim();
      if (!applyToAll && !targetName) {
        return { ok: false, status: 400, error: "Valitse kohdepari tai käytä Siirrä kaikkiin." };
      }
      const targetNames = applyToAll
        ? syms.map((s) => (s && s.name ? String(s.name) : "")).filter(Boolean)
        : [targetName];
      if (targetNames.length === 0) {
        return { ok: false, status: 400, error: "Ei kohdesymboleja." };
      }
      const applied: string[] = [];
      for (const nm of targetNames) {
        const baselineSym = baselineByName.get(nm);
        if (!baselineSym) {
          if (applyToAll) continue;
          return {
            ok: false,
            status: 400,
            error: `Baseline ei sisällä paria "${nm}" (pörssi ${baselineEx.name ?? "?"}).`,
          };
        }
        const sIdx = syms.findIndex((s) => s && s.name === nm);
        if (sIdx < 0) {
          if (applyToAll) continue;
          return {
            ok: false,
            status: 400,
            error: `Symbolia "${nm}" ei löydy live-asetuksista.`,
          };
        }
        const existingSym = syms[sIdx];
        const incoming = cloneJsonValue(baselineSym) as unknown as Record<string, unknown>;
        delete incoming.growingMax;
        const merged = mergeIncomingSymbolPreserveLiveRuntime(incoming, existingSym, simToLivePol);
        syms[sIdx] = merged as unknown as SymbolOptions;
        syncTakeProfitRuntimeFromConfig(syms[sIdx]);
        applied.push(nm);
      }
      if (applied.length === 0) {
        return {
          ok: false,
          status: 400,
          error: applyToAll
            ? "Yhtään live-paria ei vastannut baseline-symboleja."
            : "Kohdeparia ei voitu yhdistää.",
        };
      }
      ex.symbols = syms as SymbolOptions[];
      writeJsonFileAtomic(
        targetFilePath,
        sanitizeOptionsDocument(liveDoc as ConfigOptions)
      );
      return { ok: true, appliedSymbols: applied, basename: path.basename(targetFilePath) };
    } catch (e) {
      console.error("applyBaselineSymbolsToHoobotJsonFile:", e);
      return { ok: false, status: 500, error: "Baseline-siirto epäonnistui (tiedoston käsittely)." };
    }
  };

  app.use(express.json());

  /** CORS: sim-UI toisella portilla / toisella hostilla voi hakea symboleja ja lähettää patchin live-bottiin. */
  const simToLivePushCors = (res: express.Response): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hoobot-Apply-Key");
  };

  const stableSortJson = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(stableSortJson);
    }
    if (value != null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        out[key] = stableSortJson(obj[key]);
      }
      return out;
    }
    return value;
  };

  const sha256 = (value: unknown): string => {
    const sorted = stableSortJson(value);
    return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
  };

  const readJsonIfExists = <T>(filePath: string): T | null => {
    try {
      if (!existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  /** Grid-progress kirjoitetaan usein — lyhyt uudelleenyritys välttää tyhjän yhteenvedon kesken kirjoituksen. */
  const readJsonFileWithRetry = <T>(filePath: string, attempts = 5): T | null => {
    if (!existsSync(filePath)) return null;
    for (let i = 0; i < attempts; i++) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        if (i < attempts - 1) {
          const deadline = Date.now() + 40;
          while (Date.now() < deadline) {
            /* brief spin */
          }
        }
      }
    }
    return null;
  };

  const writeJsonSafe = (filePath: string, value: unknown): void => {
    try {
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
    } catch (e) {
      console.error("writeJsonSafe:", e);
    }
  };

  /** Grid-yhteenvedosta paras onnistunut variantti — sama muoto kuin yksittäisen simin tulos (UI / simulate-last). */
  const bestOkResultFromGridSummary = (summary: unknown): SimulationApiResult | null => {
    if (!summary || typeof summary !== "object") return null;
    const s = summary as Partial<GridRunSummary>;
    if (s.best == null || !Array.isArray(s.results)) return null;
    const idx = s.best.variantIndex;
    const row = s.results.find((r) => r && typeof r === "object" && r.variantIndex === idx);
    const res = row?.result;
    if (res && typeof res === "object" && "ok" in res && res.ok === true) {
      return {
        ...res,
        gridVariantIndex: idx,
        gridVariantCount: typeof s.variantCount === "number" ? s.variantCount : undefined,
        gridVariant: row.variant,
      };
    }
    return null;
  };

  const getCandlestoreSnapshot = (): { fileCount: number; latestMtimeMs: number } => {
    try {
      const dir = path.join(findProjectRoot(), "candlestore");
      if (!existsSync(dir)) return { fileCount: 0, latestMtimeMs: 0 };
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));
      let latest = 0;
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(dir, f));
          if (st.mtimeMs > latest) latest = st.mtimeMs;
        } catch {
          // ignore single-file stat errors
        }
      }
      return { fileCount: files.length, latestMtimeMs: Math.floor(latest) };
    } catch {
      return { fileCount: 0, latestMtimeMs: 0 };
    }
  };

  const persistSimulationResult = (
    result: SimulationApiResult,
    opts?: { baselineConfig?: ConfigOptions }
  ): void => {
    try {
      if (!result.ok && "aborted" in result && result.aborted === true) {
        return;
      }
      if (!existsSync(simulationDir)) mkdirSync(simulationDir, { recursive: true });
      let resultToStore = result;
      if (result.ok && ("persistedAt" in result || "summarySource" in result)) {
        const { persistedAt: _pa, summarySource: _ss, ...rest } = result as Extract<SimulationApiResult, { ok: true }> & {
          persistedAt?: string;
          summarySource?: string;
        };
        resultToStore = rest as SimulationApiResult;
      }
      const payload: PersistedSimulationResult = {
        savedAt: new Date().toISOString(),
        result: resultToStore,
      };
      if (opts?.baselineConfig != null) {
        payload.baselineConfig = opts.baselineConfig;
      }
      writeFileSync(simulateLastResultFile, JSON.stringify(payload, null, 2));
    } catch (e) {
      console.error("persistSimulationResult:", e);
    }
  };

  type SimPersistMeta = {
    savedAt?: string;
    sourceKey: "simulate-last" | "grid-last" | "grid-dump";
  };

  const loadPersistedSimulationWithMeta = (): { result: SimulationApiResult; meta: SimPersistMeta } | null => {
    try {
      if (existsSync(simulateLastResultFile)) {
        const raw = fs.readFileSync(simulateLastResultFile, "utf-8");
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedSimulationResult;
          if (parsed?.result && typeof parsed.result === "object" && "ok" in parsed.result) {
            return {
              result: parsed.result,
              meta: {
                savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : undefined,
                sourceKey: "simulate-last",
              },
            };
          }
        }
      }
    } catch (e) {
      console.error("loadPersistedSimulationWithMeta (simulate-last):", e);
    }
    try {
      if (existsSync(gridLastSummaryFile)) {
        const raw = fs.readFileSync(gridLastSummaryFile, "utf-8");
        if (raw) {
          const fromGrid = bestOkResultFromGridSummary(JSON.parse(raw) as unknown);
          if (fromGrid) {
            let savedAt: string | undefined;
            try {
              savedAt = new Date(fs.statSync(gridLastSummaryFile).mtimeMs).toISOString();
            } catch {
              /* ignore */
            }
            return { result: fromGrid, meta: { savedAt, sourceKey: "grid-last" } };
          }
        }
      }
    } catch (e) {
      console.error("loadPersistedSimulationWithMeta (grid-last):", e);
    }
    try {
      if (!existsSync(simulationDir)) return null;
      const names = fs
        .readdirSync(simulationDir)
        .filter((f) => f.toLowerCase().startsWith("grid-results-") && f.toLowerCase().endsWith(".json"));
      if (names.length === 0) return null;
      const ordered = [...names].sort((a, b) => {
        try {
          return fs.statSync(path.join(simulationDir, b)).mtimeMs - fs.statSync(path.join(simulationDir, a)).mtimeMs;
        } catch {
          return 0;
        }
      });
      for (const name of ordered) {
        const p = path.join(simulationDir, name);
        const dump = readJsonIfExists<unknown>(p);
        const fromDump = dump != null ? bestOkResultFromGridSummary(dump) : null;
        if (fromDump) {
          let savedAt: string | undefined;
          try {
            savedAt = new Date(fs.statSync(p).mtimeMs).toISOString();
          } catch {
            /* ignore */
          }
          return { result: fromDump, meta: { savedAt, sourceKey: "grid-dump" } };
        }
      }
    } catch (e) {
      console.error("loadPersistedSimulationWithMeta (grid-dump):", e);
    }
    return null;
  };

  const loadPersistedSimulationResult = (): SimulationApiResult | null => loadPersistedSimulationWithMeta()?.result ?? null;

  const enrichLastResultMetaForApi = (
    last: SimulationApiResult
  ): { persistedAt?: string; summarySource?: "simulate-last" | "grid-last" | "grid-dump" } => {
    if (!last.ok) return {};
    try {
      if (existsSync(simulateLastResultFile)) {
        const raw = fs.readFileSync(simulateLastResultFile, "utf-8");
        if (!raw) return {};
        const parsed = JSON.parse(raw) as PersistedSimulationResult;
        const pr = parsed?.result;
        if (!pr || typeof pr !== "object" || !("ok" in pr) || !pr.ok || !last.ok) return {};
        const prev = pr as Extract<SimulationApiResult, { ok: true }>;
        const same =
          last.candleRows === prev.candleRows &&
          Math.abs(last.finalPortfolio - prev.finalPortfolio) < 1e-6 &&
          last.roiPercent === prev.roiPercent;
        if (same) {
          return {
            persistedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : undefined,
            summarySource: "simulate-last",
          };
        }
      }
    } catch {
      /* ignore */
    }
    if (typeof last.gridVariantIndex === "number" && Number.isFinite(last.gridVariantIndex)) {
      return { summarySource: "grid-last" };
    }
    return {};
  };

  const simulationLastResultNotFoundPayload = (): Record<string, unknown> => {
    let gridDumpCount = 0;
    try {
      if (existsSync(simulationDir)) {
        gridDumpCount = fs
          .readdirSync(simulationDir)
          .filter((f) => f.toLowerCase().startsWith("grid-results-") && f.toLowerCase().endsWith(".json")).length;
      }
    } catch {
      gridDumpCount = 0;
    }
    const hasSimLast = existsSync(simulateLastResultFile);
    const hasGridLast = existsSync(gridLastSummaryFile);
    let hint =
      "Tallenna tulos: aja yksittäinen simulaatio loppuun tai grid niin että vähintään yksi variantti onnistuu. Keskeytys (aborted) ei tallennu.";
    const hasAnyArtifact = hasSimLast || hasGridLast || gridDumpCount > 0;
    if (!hasAnyArtifact) {
      hint +=
        " Kansiossa simulation/ ei ole tulostiedostoja — käynnistä npm run simulate projektin juuresta, jotta polku osuu oikeaan (findProjectRoot).";
    } else {
      hint +=
        " Joku tiedosto on olemassa, mutta tulosta ei saatu (esim. kaikki grid-variantit virheessä, tiedosto rikki tai simulate-last ei sisällä kelvollista result-kenttää).";
    }
    return {
      ok: false,
      error: "Edellistä simulaatiotulosta ei löytynyt.",
      hint,
      simulationDir,
      files: {
        simulateLastResult: hasSimLast,
        gridLastSummary: hasGridLast,
        gridResultsDumps: gridDumpCount,
      },
    };
  };

  const isNonemptyVariantPatch = (variant: unknown): boolean =>
    variant != null && typeof variant === "object" && Object.keys(variant as Record<string, unknown>).length > 0;

  /** Yksittäisen simin / grid-baselinen tulos: sama muoto kuin grid-rivillä (ensimmäinen pörssi jolla on symboleita). */
  const buildSyntheticGridVariantFromConfigOptions = (cfg: ConfigOptions | undefined): unknown | undefined => {
    if (!cfg || !Array.isArray(cfg.exchanges)) return undefined;
    const exWithSym = cfg.exchanges.find(
      (e): e is ExchangeOptions =>
        e != null &&
        typeof e === "object" &&
        typeof e.name === "string" &&
        Array.isArray(e.symbols) &&
        e.symbols.length > 0 &&
        e.symbols[0] != null &&
        typeof e.symbols[0] === "object"
    );
    if (!exWithSym) return undefined;
    const symClone = JSON.parse(JSON.stringify(exWithSym.symbols[0])) as Record<string, unknown>;
    return {
      exchanges: [
        {
          name: exWithSym.name,
          symbols: [symClone],
        },
      ],
    };
  };

  /** Grid baseline (variantIndex 0, patch {}): rakenna variantti baselineConfig / snapshot-tiedostosta. */
  const resolveGridSummaryVariant = (
    item: { variantIndex?: number; variant?: unknown },
    dump: { baselineConfig?: ConfigOptions; baselineOptionsSnapshotFile?: string }
  ): { variant: unknown; baselineOptionsSnapshotFile?: string; hasGridBaselineSnapshot: boolean } => {
    if (isNonemptyVariantPatch(item.variant)) {
      return { variant: item.variant, hasGridBaselineSnapshot: false };
    }
    if (item.variantIndex !== 0) {
      return { variant: item.variant ?? {}, hasGridBaselineSnapshot: false };
    }
    const snapPath =
      typeof dump.baselineOptionsSnapshotFile === "string" && dump.baselineOptionsSnapshotFile.trim().length > 0
        ? dump.baselineOptionsSnapshotFile.trim()
        : undefined;
    const tryFromCfg = (cfg: ConfigOptions | undefined) => {
      const syn = buildSyntheticGridVariantFromConfigOptions(cfg);
      if (syn == null) return null;
      return { variant: syn, baselineOptionsSnapshotFile: snapPath, hasGridBaselineSnapshot: true };
    };
    if (dump.baselineConfig) {
      const fromEmbedded = tryFromCfg(dump.baselineConfig);
      if (fromEmbedded) return fromEmbedded;
    }
    if (snapPath && existsSync(snapPath)) {
      try {
        const raw = fs.readFileSync(snapPath, "utf-8");
        if (raw) {
          const fromFile = tryFromCfg(JSON.parse(raw) as ConfigOptions);
          if (fromFile) return fromFile;
        }
      } catch {
        // vanha/poistettu snapshot
      }
    }
    return { variant: item.variant ?? {}, hasGridBaselineSnapshot: false };
  };

  const loadBaselineExchangesForSummaryApply = (opts: {
    baselineOptionsSnapshotFile?: string;
    gridSummaryFile?: string;
  }): ConfigOptions["exchanges"] | null => {
    const snapFromBody =
      typeof opts.baselineOptionsSnapshotFile === "string"
        ? opts.baselineOptionsSnapshotFile.trim()
        : "";
    if (snapFromBody && existsSync(snapFromBody)) {
      try {
        const rawSnap = fs.readFileSync(snapFromBody, "utf-8");
        const cfg = rawSnap ? (JSON.parse(rawSnap) as ConfigOptions) : undefined;
        if (cfg?.exchanges?.length) return cfg.exchanges;
      } catch {
        // fall through
      }
    }
    const gridFile =
      typeof opts.gridSummaryFile === "string" ? path.basename(opts.gridSummaryFile.trim()) : "";
    if (gridFile) {
      const gridPath = path.join(simulationDir, gridFile);
      if (existsSync(gridPath)) {
        try {
          const rawGrid = fs.readFileSync(gridPath, "utf-8");
          const dump = rawGrid
            ? (JSON.parse(rawGrid) as {
                baselineConfig?: ConfigOptions;
                baselineOptionsSnapshotFile?: string;
              })
            : undefined;
          if (dump?.baselineConfig?.exchanges?.length) {
            return dump.baselineConfig.exchanges;
          }
          const snapFromDump =
            typeof dump?.baselineOptionsSnapshotFile === "string"
              ? dump.baselineOptionsSnapshotFile.trim()
              : "";
          if (snapFromDump && existsSync(snapFromDump)) {
            const rawSnap2 = fs.readFileSync(snapFromDump, "utf-8");
            const cfg2 = rawSnap2 ? (JSON.parse(rawSnap2) as ConfigOptions) : undefined;
            if (cfg2?.exchanges?.length) return cfg2.exchanges;
          }
        } catch {
          // fall through
        }
      }
    }
    if (existsSync(simulateLastResultFile)) {
      try {
        const rawLast = fs.readFileSync(simulateLastResultFile, "utf-8");
        const parsed = rawLast ? (JSON.parse(rawLast) as PersistedSimulationResult) : null;
        if (parsed?.baselineConfig?.exchanges?.length) {
          return parsed.baselineConfig.exchanges;
        }
      } catch {
        // fall through
      }
    }
    return null;
  };

  const SIM_SUMMARY_UI_ROW_LIMIT = 500;
  let lastSummaryCollectError: string | null = null;

  const summarySourceRank: Record<SimulationRunSummaryRow["source"], number> = {
    "grid-progress": 5,
    "grid-last": 4,
    "grid-cache": 3,
    "grid-results": 2,
    "simulate-last": 1,
  };

  const summaryDedupeKey = (row: SimulationRunSummaryRow): string => {
    if (row.source === "simulate-last") {
      return `simulate-last|${row.file}`;
    }
    if (
      row.source === "grid-progress" ||
      row.source === "grid-last" ||
      row.source === "grid-results"
    ) {
      return `grid:${row.gridPath ?? row.file}|v:${row.variantIndex ?? -1}`;
    }
    return `${row.source}|${row.file}|v:${row.variantIndex ?? -1}`;
  };

  const savedAtFromGridResultsFileName = (fileName: string, fileMtime?: string): string | undefined => {
    const m = fileName.match(/^grid-results-(\d+)\.json$/i);
    if (!m) return fileMtime;
    const ts = Number(m[1]);
    if (!Number.isFinite(ts) || ts <= 0) return fileMtime;
    return new Date(ts).toISOString();
  };

  const parseSummarySavedAtQueryMs = (raw: unknown): number | undefined => {
    if (raw == null) return undefined;
    const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
    if (!s) return undefined;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  };

  const summaryRowSavedAtMs = (row: SimulationRunSummaryRow): number => {
    if (!row.savedAt) return 0;
    const t = Date.parse(row.savedAt);
    return Number.isFinite(t) ? t : 0;
  };

  const normalizeSummarySortKey = (
    raw: unknown
  ): "time" | "roi" | "finalPortfolio" | "tp" | "sl" => {
    const k = String(raw ?? "").trim();
    if (k === "time" || k === "finalPortfolio" || k === "roi" || k === "tp" || k === "sl") return k;
    return "time";
  };

  const summaryRowTradeStat = (row: SimulationRunSummaryRow, field: "takeProfits" | "stopLosses"): number =>
    Number(row.tradeStats?.[field]) || 0;

  const sortSimulationSummaryRows = (
    rows: SimulationRunSummaryRow[],
    sortBy: string,
    sortDir: string
  ): SimulationRunSummaryRow[] => {
    const key = normalizeSummarySortKey(sortBy);
    const dirMul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = 0;
      let bv = 0;
      if (key === "time") {
        av = summaryRowSavedAtMs(a);
        bv = summaryRowSavedAtMs(b);
      } else if (key === "finalPortfolio") {
        av = Number(a.finalPortfolio) || 0;
        bv = Number(b.finalPortfolio) || 0;
      } else if (key === "tp") {
        av = summaryRowTradeStat(a, "takeProfits");
        bv = summaryRowTradeStat(b, "takeProfits");
      } else if (key === "sl") {
        av = summaryRowTradeStat(a, "stopLosses");
        bv = summaryRowTradeStat(b, "stopLosses");
      } else {
        av = Number(a.roi) || 0;
        bv = Number(b.roi) || 0;
      }
      if (av !== bv) return av > bv ? dirMul : -dirMul;
      const at = summaryRowSavedAtMs(a);
      const bt = summaryRowSavedAtMs(b);
      return dirMul === 1 ? at - bt : bt - at;
    });
  };

  const summaryRowMatchesSavedAtRange = (
    row: SimulationRunSummaryRow,
    fromMs: number | undefined,
    toMs: number | undefined
  ): boolean => {
    if (fromMs == null && toMs == null) return true;
    const t = summaryRowSavedAtMs(row);
    if (t <= 0) return false;
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  };

  const formatSummarySavedAtFilterFi = (fromMs?: number, toMs?: number): string => {
    const fmt = (ms: number) => new Date(ms).toLocaleString("fi-FI");
    if (fromMs != null && toMs != null) return `${fmt(fromMs)} – ${fmt(toMs)}`;
    if (fromMs != null) return `alkaen ${fmt(fromMs)}`;
    if (toMs != null) return `päättyen ${fmt(toMs)}`;
    return "";
  };

  const shouldPreferSummaryRow = (
    candidate: SimulationRunSummaryRow,
    incumbent: SimulationRunSummaryRow
  ): boolean => {
    const cr = summarySourceRank[candidate.source] ?? 0;
    const ir = summarySourceRank[incumbent.source] ?? 0;
    if (cr !== ir) return cr > ir;
    const ct = candidate.savedAt ? Date.parse(candidate.savedAt) : 0;
    const it = incumbent.savedAt ? Date.parse(incumbent.savedAt) : 0;
    if (ct !== it) return ct > it;
    return false;
  };

  const readGridProgressSnapshot = (): {
    partial: boolean;
    variantCount: number;
    okResults: number;
    totalResults: number;
    updatedAt?: string;
    gridPath?: string;
  } | null => {
    const parsed = readJsonFileWithRetry<{
      partial?: boolean;
      variantCount?: number;
      updatedAt?: string;
      gridPath?: string;
      results?: Array<{ result?: { ok?: boolean } }>;
    }>(path.join(simulationDir, "grid-progress-summary.json"), 5);
    if (!parsed || !Array.isArray(parsed.results)) return null;
    const okResults = parsed.results.filter((r) => r?.result?.ok === true).length;
    return {
      partial: parsed.partial === true,
      variantCount: typeof parsed.variantCount === "number" ? parsed.variantCount : parsed.results.length,
      okResults,
      totalResults: parsed.results.length,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      gridPath: typeof parsed.gridPath === "string" ? parsed.gridPath : undefined,
    };
  };

  const collectSimulationSummaryDiagnostics = (): {
    gridResultsFileCount: number;
    gridProgressResultCount: number;
    gridLastOkCount: number;
    simulateLastOk: boolean;
    hint: string;
  } => {
    let gridResultsFileCount = 0;
    let gridProgressResultCount = 0;
    let gridLastOkCount = 0;
    let simulateLastOk = false;
    try {
      if (existsSync(simulationDir)) {
        const names = fs.readdirSync(simulationDir);
        for (const name of names) {
          const lower = name.toLowerCase();
          if (lower.startsWith("grid-results-") && lower.endsWith(".json")) {
            gridResultsFileCount++;
          }
        }
        const progress = readJsonFileWithRetry<{ results?: Array<{ result?: { ok?: boolean } }> }>(
          path.join(simulationDir, "grid-progress-summary.json")
        );
        if (progress?.results) {
          gridProgressResultCount = progress.results.filter((r) => r?.result?.ok).length;
        }
        const gridLast = readJsonIfExists<{ results?: Array<{ result?: { ok?: boolean } }> }>(
          gridLastSummaryFile
        );
        if (gridLast?.results) {
          gridLastOkCount = gridLast.results.filter((r) => r?.result?.ok).length;
        }
      }
      const simLast = readJsonIfExists<PersistedSimulationResult>(simulateLastResultFile);
      simulateLastOk = !!simLast?.result?.ok;
    } catch {
      // ignore
    }
    let hint =
      "Tallenna tulos: aja yksittäinen simulaatio loppuun tai grid niin että vähintään yksi variantti onnistuu. Keskeytys (aborted) ei tallennu yhteenvetoon.";
    if (gridResultsFileCount > 0 && gridProgressResultCount === 0) {
      hint +=
        " Kansiossa on vanhoja grid-results-*.json -tiedostoja; jos lista on silti tyhjä, käynnistä simulaatio uudelleen (npm run simulate:start:build) portissa 5657 ja päivitä sivu.";
    } else if (gridProgressResultCount === 0 && gridLastOkCount === 0 && !simulateLastOk) {
      hint +=
        " grid-progress-summary.json on tyhjä (uusi grid käynnissä tai keskeytetty) — odota ensimmäistä onnistunutta varianttia tai käynnistä grid uudelleen.";
    }
    return {
      gridResultsFileCount,
      gridProgressResultCount,
      gridLastOkCount,
      simulateLastOk,
      hint,
    };
  };

  const collectSimulationSummaryRows = (): SimulationRunSummaryRow[] => {
    lastSummaryCollectError = null;
    const rows: SimulationRunSummaryRow[] = [];
    const dedupe = new Map<string, SimulationRunSummaryRow>();
    try {
      if (!existsSync(simulationDir)) return rows;
      const names = fs.readdirSync(simulationDir);
      for (const name of names) {
        const lower = name.toLowerCase();
        const fullPath = path.join(simulationDir, name);
        let savedAt: string | undefined;
        try {
          savedAt = new Date(fs.statSync(fullPath).mtimeMs).toISOString();
        } catch {
          savedAt = undefined;
        }
        if (
          (lower.startsWith("grid-results-") && lower.endsWith(".json")) ||
          lower === "grid-progress-summary.json" ||
          lower === "grid-last-summary.json"
        ) {
          const useRetryRead =
            lower === "grid-progress-summary.json" || lower === "grid-last-summary.json";
          const parsed = useRetryRead
            ? readJsonFileWithRetry<unknown>(fullPath, 5)
            : readJsonIfExists<unknown>(fullPath);
          if (!parsed || typeof parsed !== "object") continue;
          const dump = parsed as {
            gridPath?: string;
            updatedAt?: string;
            baselineConfig?: ConfigOptions;
            baselineOptionsSnapshotFile?: string;
            results?: Array<{
              variantIndex?: number;
              variant?: unknown;
              result?: SimulationApiResult;
              completedAt?: string;
            }>;
          };
          const sourceType: SimulationRunSummaryRow["source"] =
            lower === "grid-progress-summary.json"
              ? "grid-progress"
              : lower === "grid-last-summary.json"
                ? "grid-last"
                : "grid-results";
          const dumpSavedAt =
            (sourceType === "grid-progress" || sourceType === "grid-last") &&
            typeof dump.updatedAt === "string"
              ? dump.updatedAt
              : sourceType === "grid-results"
                ? savedAtFromGridResultsFileName(name, savedAt)
                : savedAt;
          const resultRows = Array.isArray(dump.results) ? dump.results : [];
          for (const item of resultRows) {
            const r = item?.result;
            if (!r || typeof r !== "object" || !("ok" in r) || !r.ok) continue;
            const resolvedGrid = resolveGridSummaryVariant(item, dump);
            const fileSavedAtForRow =
              sourceType === "grid-results"
                ? savedAtFromGridResultsFileName(name, savedAt)
                : dumpSavedAt;
            const rowSavedAt =
              typeof item.completedAt === "string" ? item.completedAt : fileSavedAtForRow;
            const dumpBaselineSnap =
              typeof dump.baselineOptionsSnapshotFile === "string"
                ? dump.baselineOptionsSnapshotFile.trim()
                : "";
            const dumpHasBaseline = !!(dump.baselineConfig || dumpBaselineSnap);
            const baselineResolvable = loadBaselineExchangesForSummaryApply({
              baselineOptionsSnapshotFile: dumpBaselineSnap || undefined,
              gridSummaryFile: name,
            });
            const flatValues = (() => {
              const flat = flattenLeafValues(resolvedGrid.variant);
              if (dumpBaselineSnap) {
                flat["baseline.optionsSnapshotFile"] = dumpBaselineSnap;
              }
              return flat;
            })();
            const applyResolved = resolveSummaryApplyVariant(resolvedGrid.variant, flatValues);
            const row: SimulationRunSummaryRow = {
              source: sourceType,
              file: name,
              savedAt: rowSavedAt,
              gridPath: typeof dump.gridPath === "string" ? dump.gridPath : undefined,
              variantIndex: typeof item.variantIndex === "number" ? item.variantIndex : undefined,
              roi: r.roi,
              roiPercent: r.roiPercent,
              startingBalance: r.startingBalance,
              finalPortfolio: r.finalPortfolio,
              candleRows: r.candleRows,
              tradeStats: aggregateTradeStatsFromResult(r),
              variant: resolvedGrid.variant,
              baselineOptionsSnapshotFile:
                resolvedGrid.baselineOptionsSnapshotFile || dumpBaselineSnap || undefined,
              hasGridBaselineSnapshot: resolvedGrid.hasGridBaselineSnapshot || dumpHasBaseline,
              canApplyVariant: applyResolved.canApply,
              applyVariant: applyResolved.applyVariant ?? undefined,
              canApplyBaseline: !!(baselineResolvable && baselineResolvable.length > 0),
              values: flatValues,
            };
            const key = summaryDedupeKey(row);
            const prev = dedupe.get(key);
            if (!prev || shouldPreferSummaryRow(row, prev)) {
              dedupe.set(key, row);
            }
          }
        } else if (name === "simulate-last-result.json") {
          const parsed = readJsonIfExists<PersistedSimulationResult>(fullPath);
          if (!parsed?.result || !parsed.result.ok) continue;
          const r = parsed.result;
          let resolvedVariant: unknown = undefined;
          const rawGridVariant = r.gridVariant;
          if (rawGridVariant != null && typeof rawGridVariant === "object") {
            const gvResolved = resolveSummaryApplyVariant(rawGridVariant);
            if (gvResolved.canApply) resolvedVariant = rawGridVariant;
          }
          if (resolvedVariant == null) {
            resolvedVariant = buildSyntheticGridVariantFromConfigOptions(parsed.baselineConfig);
            if (resolvedVariant == null) {
              try {
                if (existsSync(optionsFilename)) {
                  const rawSim = fs.readFileSync(optionsFilename, "utf-8");
                  if (rawSim) {
                    const simDoc = JSON.parse(rawSim) as ConfigOptions;
                    resolvedVariant = buildSyntheticGridVariantFromConfigOptions(simDoc);
                  }
                }
              } catch {
                // vanhat tiedostot / rikkinäinen JSON
              }
            }
          }
          const simFlatValues = flattenLeafValues(
            resolvedVariant != null && typeof resolvedVariant === "object" ? resolvedVariant : {}
          );
          const simApplyResolved = resolveSummaryApplyVariant(resolvedVariant, simFlatValues);
          const simHasBaseline = !!(
            parsed.baselineConfig &&
            Array.isArray(parsed.baselineConfig.exchanges) &&
            parsed.baselineConfig.exchanges.length > 0
          );
          const simBaselineResolvable = simHasBaseline
            ? loadBaselineExchangesForSummaryApply({})
            : null;
          const row: SimulationRunSummaryRow = {
            source: "simulate-last",
            file: name,
            savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : savedAt,
            roi: r.roi,
            roiPercent: r.roiPercent,
            startingBalance: r.startingBalance,
            finalPortfolio: r.finalPortfolio,
            candleRows: r.candleRows,
            tradeStats: aggregateTradeStatsFromResult(r),
            variant: resolvedVariant,
            values: simFlatValues,
            canApplyVariant: simApplyResolved.canApply,
            applyVariant: simApplyResolved.applyVariant ?? undefined,
            canApplyBaseline: !!(simBaselineResolvable && simBaselineResolvable.length > 0),
            hasPersistedBaseline: simHasBaseline,
          };
          const key = summaryDedupeKey(row);
          const prev = dedupe.get(key);
          if (!prev || shouldPreferSummaryRow(row, prev)) {
            dedupe.set(key, row);
          }
        }
      }
      // Älä näytä simulation/cache/grid-variants -rivejä yhteenvedossa: sama variantti on jo grid-progress-summary.json:ssa.
    } catch (e) {
      lastSummaryCollectError = e instanceof Error ? e.message : String(e);
      console.error("collectSimulationSummaryRows:", e);
    }
    rows.push(...dedupe.values());
    return rows;
  };

  /** Simulaatio- ja grid-tila — ennen reittejä, jotta /simulate/* ja /simulate/grid viittaavat samaan tilaan. */
  let simGridRunning = false;
  let simGridAbortRequested = false;
  let simGridStartedAt: number | null = null;
  let simGridLastSummary: GridRunSummary | null = null;
  let simGridLastError: string | null = null;
  let simGridProgress: GridRuntimeProgress | null = null;
  let simulateRunning = false;
  let simulateAbortRequested = false;
  let simulateStartedAt: number | null = null;
  let simulateLastResult: SimulationApiResult | null = loadPersistedSimulationResult();
  let simulateLastError: string | null = null;
  let simulateProgress: SimulationProgress | null = null;

  registerHealthRoutes(app, { options, isSimulateInstance });
  registerDashboardRoutes(app, {
    options,
    isSimulateInstance,
    resolveDashboardExchange,
    pnlCacheByKey,
    priceChartCacheByKey,
    PNL_CACHE_MS,
    PRICE_CHART_CACHE_MS,
    roundTripPnlAfterFees,
    logger,
  });

  // Resolve Frontend directory: try next to bundle, then cwd/build, build-dev, src.
  // Fallback: bundle dir (legacy copy put index.html next to hoobot.js).
  const candidates = [
    path.join(__dirname, "Frontend"),
    path.join(process.cwd(), "build", "Frontend"),
    path.join(process.cwd(), "build-dev", "Frontend"),
    path.join(process.cwd(), "src", "Frontend"),
    ...(existsSync(path.join(__dirname, "index.html")) ? [__dirname] : []),
  ];
  let frontendPath = candidates.find((p) => existsSync(p));
  if (!frontendPath) {
    frontendPath = path.join(__dirname, "Frontend");
    logger.warn(
      "Frontend folder not found. Tried:",
      candidates.join(", "),
      "- Run 'npm run build' to copy Frontend into build/"
    );
  } else {
    logger.info("Serving frontend from:", frontendPath);
  }
  app.use(express.static(frontendPath));

  const indexPath = path.resolve(frontendPath, "index.html");
  app.get("/", (_, res) => {
    if (!existsSync(indexPath)) {
      res.status(404).send(`index.html not found. Frontend path: ${frontendPath}`);
      return;
    }
    res.sendFile(indexPath);
  });

  app.get("/simulate", async (req, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Simulate endpoint only available when SIMULATE=true." });
      return;
    }
    const useLastRaw = req.query.useLast;
    const useLast = String(Array.isArray(useLastRaw) ? useLastRaw[0] : useLastRaw ?? "").toLowerCase() === "true";
    if (useLast) {
      const last = simulateLastResult ?? loadPersistedSimulationResult();
      if (last) {
        res.json(last);
        return;
      }
      res.status(404).json(simulationLastResultNotFoundPayload());
      return;
    }
    if (simulateRunning) {
      res.status(409).json({ ok: false, error: "Simulaatio on jo käynnissä." });
      return;
    }
    simulateAbortRequested = false;
    simulateRunning = true;
    simulateProgress = { phase: "loading", message: "Aloitetaan simulaatio…" };
    const cfg = validateOptions(JSON.parse(JSON.stringify(parseArgsSimulate())) as ConfigOptions);
    const yearsRaw = req.query.years;
    if (yearsRaw != null) {
      const yearsNum = Number(Array.isArray(yearsRaw) ? yearsRaw[0] : yearsRaw);
      if (Number.isFinite(yearsNum) && yearsNum >= 0) {
        cfg.simulationHistoryYears = yearsNum;
      }
    }
    const baselineSnapshot = maskConfigSecretsForExport(JSON.parse(JSON.stringify(cfg)) as ConfigOptions);
    const result = await runSimulationWithConfig(cfg, undefined, () => simulateAbortRequested, (p) => {
      simulateProgress = p;
    }, { saveCheckpoints: true });
    simulateRunning = false;
    simulateProgress = null;
    simulateLastResult = result;
    simulateLastError = result.ok ? null : result.error;
    persistSimulationResult(result, { baselineConfig: baselineSnapshot });
    if (result.ok) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  });

  /** Taustalla ajettava yksittäinen simulaatio (UI voi pollata tilaa selaimen uudelleenlatauksen jälkeen). */
  app.post("/simulate/start", (req, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Simulate endpoint only available when SIMULATE=true." });
      return;
    }
    if (simulateRunning) {
      res.status(409).json({ ok: false, error: "Simulaatio on jo käynnissä." });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as { years?: unknown; resume?: boolean }) : {};
    const yearsNum = Number(body.years ?? NaN);
    const resume = body.resume === true;
    const checkpointPath = defaultSimulationCheckpointPath();
    if (resume) {
      const cp = readSimulationCheckpointFile(checkpointPath);
      if (!cp) {
        res.status(400).json({
          ok: false,
          error: "Checkpointia ei löydy (simulation/simulate-checkpoint.json). Ei voi jatkaa — aja simulaatio alusta.",
        });
        return;
      }
    } else {
      /** Synkronoitu ennen HTTP-vastausta ja setImmediateä — näin /simulate/checkpoint ei näytä väärää tilaa käynnistyessä uusi ajo. */
      deleteSimulationCheckpointFile(checkpointPath);
    }
    simulateAbortRequested = false;
    simulateRunning = true;
    simulateStartedAt = Date.now();
    simulateLastError = null;
    simulateProgress = {
      phase: "loading",
      message: resume ? "Jatketaan tallennetusta tilasta…" : "Aloitetaan simulaatio…",
    };
    setImmediate(() => {
      const cfg = validateOptions(JSON.parse(JSON.stringify(parseArgsSimulate())) as ConfigOptions);
      if (Number.isFinite(yearsNum) && yearsNum >= 0) {
        cfg.simulationHistoryYears = yearsNum;
      }
      const baselineSnapshot = maskConfigSecretsForExport(JSON.parse(JSON.stringify(cfg)) as ConfigOptions);
      const simCacheKey = sha256({
        config: cfg,
        years: Number.isFinite(yearsNum) && yearsNum >= 0 ? yearsNum : cfg.simulationHistoryYears ?? null,
        dataSnapshot: getCandlestoreSnapshot(),
      });
      const simCacheFile = path.join(simulationSingleCacheDir, `${simCacheKey}.json`);
      if (!resume) {
        const cached = readJsonIfExists<{ savedAt: string; result: SimulationApiResult }>(simCacheFile);
        if (cached?.result?.ok) {
          console.log("[simulate] Tulos palautettiin välimuistista — ei uutta ajoa.");
          simulateLastResult = cached.result;
          simulateLastError = null;
          simulateRunning = false;
          simulateStartedAt = null;
          simulateProgress = null;
          persistSimulationResult(cached.result, { baselineConfig: baselineSnapshot });
          return;
        }
      }
      runSimulationWithConfig(
        cfg,
        undefined,
        () => simulateAbortRequested,
        (p) => {
          simulateProgress = p;
        },
        { resumeFromFile: resume, checkpointPath, saveCheckpoints: true }
      )
        .then((r) => {
          simulateLastResult = r;
          simulateLastError = r.ok ? null : r.error;
          persistSimulationResult(r, { baselineConfig: baselineSnapshot });
          if (r.ok) {
            writeJsonSafe(simCacheFile, { savedAt: new Date().toISOString(), result: r });
          }
          simulateRunning = false;
          simulateProgress = null;
        })
        .catch((e) => {
          simulateLastError = e instanceof Error ? e.message : String(e);
          simulateRunning = false;
          simulateProgress = null;
          console.error("simulate/start:", e);
        });
    });
    res.json({
      ok: true,
      message: resume ? "Simulaation jatkaminen käynnistetty taustalla." : "Simulaatio käynnistetty taustalla.",
      years: Number.isFinite(yearsNum) ? yearsNum : undefined,
      resume,
    });
  });

  /** Checkpoint-tiedoston metatiedot (jatko-UI). */
  app.get("/simulate/checkpoint", (_, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Vain SIMULATE-istunto." });
      return;
    }
    const cp = readSimulationCheckpointFile(defaultSimulationCheckpointPath());
    if (!cp) {
      res.json({ ok: true, exists: false });
      return;
    }
    const symName = cp.symbolsOrder[cp.symIdx] ?? "?";
    const passTotal = cp.symbolsOrder.length;
    const cfg = validateOptions(JSON.parse(JSON.stringify(parseArgsSimulate())) as ConfigOptions);
    let fingerprintMatches = false;
    let fingerprintHint: string | undefined;
    if (cp.version === 1) {
      fingerprintHint =
        "Checkpoint on versiota 1 (vanha muoto). Tyhjennä checkpoint ja aja uusi simulaatio, tai jatko epäonnistuu.";
    } else {
      try {
        fingerprintMatches = cp.fingerprint === buildSimulationCheckpointFingerprint(cfg, cp.candleRows);
      } catch {
        fingerprintMatches = false;
      }
      if (!fingerprintMatches) {
        fingerprintHint =
          "Nykyiset simulate-asetukset eivät täsmää checkpointiin (tai kynttilärivimäärä muuttunut) — jatko voi epäonnistua.";
      }
    }
    res.json({
      ok: true,
      exists: true,
      version: cp.version,
      savedAt: cp.savedAt,
      symIdx: cp.symIdx,
      candleIndex: cp.candleIndex,
      candleRows: cp.candleRows,
      symbolLabel: `${symName} (erä ${cp.symIdx + 1}/${passTotal})`,
      percentInPass: cp.candleRows > 0 ? (cp.candleIndex / cp.candleRows) * 100 : 0,
      fingerprintMatches,
      fingerprintHint,
    });
  });

  /** Poista checkpoint (aloita seuraava ajo aina alusta). */
  app.post("/simulate/checkpoint/clear", (_, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Vain SIMULATE-istunto." });
      return;
    }
    deleteSimulationCheckpointFile(defaultSimulationCheckpointPath());
    res.json({ ok: true, message: "Checkpoint poistettu." });
  });

  app.get("/simulate/status", (_, res) => {
    res.json({
      running: simulateRunning,
      startedAt: simulateStartedAt,
      lastResult: simulateLastResult,
      lastError: simulateLastError,
      abortRequested: simulateAbortRequested,
      progress: simulateProgress,
    });
  });

  app.get("/simulate/last", (_, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Simulate endpoint only available when SIMULATE=true." });
      return;
    }
    if (simulateLastResult) {
      if (simulateLastResult.ok) {
        const extra = enrichLastResultMetaForApi(simulateLastResult);
        res.json({ ...simulateLastResult, ...extra });
      } else {
        res.json(simulateLastResult);
      }
      return;
    }
    const fromDisk = loadPersistedSimulationWithMeta();
    if (!fromDisk) {
      res.status(404).json(simulationLastResultNotFoundPayload());
      return;
    }
    const { result, meta } = fromDisk;
    if (result.ok) {
      res.json({
        ...result,
        persistedAt: meta.savedAt,
        summarySource: meta.sourceKey,
      });
    } else {
      res.json(result);
    }
  });

  /** Kaikkien simulaatioajojen yhteenveto (parhaat ROI:t + varianttiarvot). */
  app.get("/simulate/summary", (req, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({
        ok: false,
        error: "Simulate endpoint only available when SIMULATE=true.",
        hint: "Avaa simulaatio-istunto portissa 5657 (npm run simulate tai simulate:start:build), ei live-portissa 5656.",
      });
      return;
    }
    const minRoiRaw = req.query.minRoi;
    const minRoi =
      minRoiRaw != null && String(minRoiRaw).trim() !== "" ? Number(String(minRoiRaw).trim()) : undefined;
    const minRoiPercentRaw = req.query.minRoiPercent;
    const minRoiFromPercent =
      minRoiPercentRaw != null && String(minRoiPercentRaw).trim() !== ""
        ? Number(String(minRoiPercentRaw).trim()) / 100
        : undefined;
    const minRoiFilter =
      minRoiFromPercent != null && Number.isFinite(minRoiFromPercent)
        ? minRoiFromPercent
        : minRoi != null && Number.isFinite(minRoi)
          ? minRoi
          : undefined;
    const savedFromMs = parseSummarySavedAtQueryMs(req.query.savedFrom);
    const savedToMs = parseSummarySavedAtQueryMs(req.query.savedTo);
    if (savedFromMs != null && savedToMs != null && savedFromMs > savedToMs) {
      res.status(400).json({
        ok: false,
        error: "Aikaväli virheellinen: Alkaen on myöhemmin kuin Päättyen.",
      });
      return;
    }

    let allRowsCollected = collectSimulationSummaryRows();
    const gridProgressEarly = readGridProgressSnapshot();
    if (
      allRowsCollected.length === 0 &&
      gridProgressEarly &&
      gridProgressEarly.okResults > 0 &&
      !lastSummaryCollectError
    ) {
      allRowsCollected = collectSimulationSummaryRows();
    }
    if (lastSummaryCollectError) {
      res.status(500).json({
        ok: false,
        error: `Yhteenvetorivien keruu epäonnistui: ${lastSummaryCollectError}`,
        diagnostics: collectSimulationSummaryDiagnostics(),
      });
      return;
    }
    const totalCountUnfiltered = allRowsCollected.length;
    const afterDateRows =
      savedFromMs != null || savedToMs != null
        ? allRowsCollected.filter((row) => summaryRowMatchesSavedAtRange(row, savedFromMs, savedToMs))
        : allRowsCollected;
    const totalCountAfterDate = afterDateRows.length;
    const allRows =
      minRoiFilter != null
        ? afterDateRows.filter((row) => Number.isFinite(row.roi) && row.roi >= minRoiFilter)
        : afterDateRows;
    const totalCount = allRows.length;
    const sortBy = normalizeSummarySortKey(req.query.sortBy);
    const sortDirRaw = req.query.sortDir;
    const sortDir =
      sortDirRaw != null && String(sortDirRaw).trim() === "asc" ? "asc" : "desc";
    const sortedForUi = sortSimulationSummaryRows(allRows, sortBy, sortDir);
    const rows = sortedForUi.slice(0, SIM_SUMMARY_UI_ROW_LIMIT);
    const truncated = totalCount > rows.length;
    const bestByRoi = sortSimulationSummaryRows(allRows, "roi", "desc");
    const best = bestByRoi.length > 0 ? bestByRoi[0] : null;
    const gridProgress = gridProgressEarly ?? readGridProgressSnapshot();
    const payload: Record<string, unknown> = {
      ok: true,
      simulationUi: isSimulateInstance,
      simulationDir,
      totalCountUnfiltered,
      totalCount,
      count: rows.length,
      truncated,
      sortBy,
      sortDir,
      minRoiFilter: minRoiFilter ?? null,
      savedFrom: savedFromMs != null ? new Date(savedFromMs).toISOString() : null,
      savedTo: savedToMs != null ? new Date(savedToMs).toISOString() : null,
      totalCountAfterDate,
      best,
      rows,
      gridProgress,
      simGridRunning,
    };
    if (truncated) {
      const sortLabel =
        sortBy === "time"
          ? sortDir === "desc"
            ? "uusin ensin"
            : "vanhin ensin"
          : sortBy === "finalPortfolio"
            ? "loppusaldo"
            : sortBy === "tp"
              ? "TP"
              : sortBy === "sl"
                ? "SL"
                : "ROI";
      payload.truncatedHint = `Näytetään ${rows.length} / ${totalCount} riviä (${sortLabel}). Kaikki ${totalCount} riviä ovat simulation/-kansiossa.`;
    }
    if (totalCount === 0) {
      payload.diagnostics = collectSimulationSummaryDiagnostics();
      if (gridProgress && gridProgress.okResults > 0 && minRoiFilter != null) {
        const diag = payload.diagnostics as { hint?: string };
        diag.hint =
          `${diag.hint ?? ""} Min ROI -suodatin piilottaa valmiit grid-variantit (useimmat ROI:t ovat negatiivisia). Tyhjennä Min ROI % -kenttä.`.trim();
      }
      if ((savedFromMs != null || savedToMs != null) && totalCountAfterDate === 0 && totalCountUnfiltered > 0) {
        const diag = payload.diagnostics as { hint?: string };
        diag.hint =
          `${diag.hint ?? ""} Aikavälisuodatin (${formatSummarySavedAtFilterFi(savedFromMs, savedToMs)}) ei löytänyt rivejä — laajenna väliä tai tyhjennä Alkaen/Päättyen.`.trim();
      }
    } else {
      const filterParts: string[] = [];
      if ((savedFromMs != null || savedToMs != null) && totalCountAfterDate < totalCountUnfiltered) {
        filterParts.push(
          `aika (${formatSummarySavedAtFilterFi(savedFromMs, savedToMs)}): ${totalCountAfterDate} / ${totalCountUnfiltered} riviä`
        );
      }
      if (minRoiFilter != null && totalCount < totalCountAfterDate) {
        filterParts.push(`Min ROI: ${totalCount} / ${totalCountAfterDate} riviä`);
      }
      if (filterParts.length > 0) {
        payload.filteredHint = `${filterParts.join("; ")}. Tyhjennä suodattimet nähdäksesi kaikki ajot.`;
      }
    }
    res.json(payload);
  });

  /** Arvioi gridin varianttimäärä ennen käynnistystä (UI-varoitus). */
  app.post("/simulate/grid-estimate", (req, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Simulate endpoint only available when SIMULATE=true." });
      return;
    }
    try {
      const body = req.body && typeof req.body === "object" ? (req.body as { configPath?: unknown }) : {};
      const relPath =
        typeof body.configPath === "string" && String(body.configPath).trim() !== ""
          ? String(body.configPath).trim()
          : "settings/sim-grid.example.json";
      const absPath = resolveProjectRelativePath(relPath);
      if (!existsSync(absPath)) {
        res.status(400).json({ ok: false, error: `Grid-tiedostoa ei löydy: ${relPath}` });
        return;
      }
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      const v = validateGridPayload(parsed);
      if (!v.ok) {
        res.status(400).json({ ok: false, error: `Grid-validointi epäonnistui:\n- ${v.errors.join("\n- ")}` });
        return;
      }
      const count = estimateGridVariantCount(v.data);
      res.json({ ok: true, count, configPath: relPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Keskeytä käynnissä oleva simulaatio (replay-loop) tai grid-variantit */
  app.post("/simulate/stop", (_, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({ ok: false, error: "Simulaation stop on vain SIMULATE-istunnossa." });
      return;
    }
    simulateAbortRequested = true;
    simGridAbortRequested = true;
    res.json({ ok: true, message: "Simulaation/gridin keskeytys pyydetty." });
  });

  /** Taustalla ajettava grid (useita variantteja). Vaatii SIMULATE=true ja simGrid.enabled. */
  app.post("/simulate/grid", (req, res) => {
    if (process.env.SIMULATE !== "true") {
      res.status(403).json({
        error: "Grid-simulaatio on vain SIMULATE-istunnossa (esim. portti 5657).",
      });
      return;
    }
    /** Sama lähde kuin executeSimGrid (fallback hoobot-options.json jos simulate-tiedostoa ei ole). */
    const fresh = validateOptions(JSON.parse(JSON.stringify(parseArgsSimulate())) as ConfigOptions);
    if (!fresh.simGrid?.enabled) {
      const settingsName = isSimulateInstance ? "hoobot-options-simulate.json" : "hoobot-options.json";
      res.status(403).json({
        error: `Ota grid käyttöön: aseta simGrid.enabled = true ja tallenna asetukset (${settingsName}).`,
      });
      return;
    }
    if (simGridRunning) {
      res.status(409).json({ error: "Grid-simulaatio on jo käynnissä." });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as { configPath?: unknown }) : {};
    const pathFromBody =
      typeof body.configPath === "string" && String(body.configPath).trim() !== ""
        ? String(body.configPath).trim()
        : "";
    const relPath =
      pathFromBody || fresh.simGrid?.configPath || "settings/sim-grid.example.json";
    const absPath = resolveProjectRelativePath(relPath);
    if (!existsSync(absPath)) {
      res.status(400).json({
        error: `Grid-tiedostoa ei löydy: ${relPath} (ratkaistu: ${absPath}). Varmista polku projektin juuresta ja että tiedosto on olemassa.`,
      });
      return;
    }
    const gridRaw = fs.readFileSync(absPath, "utf-8");
    const gridCacheKey = sha256({
      gridPath: relPath,
      gridRaw,
      config: fresh,
      dataSnapshot: getCandlestoreSnapshot(),
    });
    const gridCacheFile = path.join(simulationGridCacheDir, `${gridCacheKey}.json`);
    const cachedGrid = readJsonIfExists<{ savedAt: string; summary: GridRunSummary }>(gridCacheFile);
    if (cachedGrid?.summary) {
      simGridLastSummary = cachedGrid.summary;
      simGridLastError = null;
      simGridRunning = false;
      simGridProgress = null;
      simGridStartedAt = null;
      const bestFromCache = bestOkResultFromGridSummary(cachedGrid.summary);
      if (bestFromCache) {
        simulateLastResult = bestFromCache;
        persistSimulationResult(bestFromCache, {
          baselineConfig: cachedGrid.summary.baselineConfig,
        });
      }
      console.log(
        `[sim-grid] Tulos palautettiin välimuistista (sama grid + asetukset) — ei uutta ajoa. Polku: ${relPath}`
      );
      res.json({
        ok: true,
        cached: true,
        message: "Grid-tulos löytyi cachesta (samoin asetuksin) — ajoa ei käynnistetty uudelleen.",
        path: relPath,
      });
      return;
    }
    simGridRunning = true;
    simGridAbortRequested = false;
    simGridStartedAt = Date.now();
    simulateAbortRequested = false;
    simGridLastError = null;
    simGridLastSummary = null;
    simGridProgress = null;
    console.log(`[sim-grid] Käynnistetään taustalla: ${relPath}`);
    setImmediate(() => {
      executeSimGrid(absPath, () => simGridAbortRequested, (p) => {
        simGridProgress = p;
      })
        .then((summary) => {
          simGridLastSummary = summary;
          writeJsonSafe(gridCacheFile, { savedAt: new Date().toISOString(), summary });
          const best = bestOkResultFromGridSummary(summary);
          if (best) {
            simulateLastResult = best;
            persistSimulationResult(best, { baselineConfig: summary.baselineConfig });
          }
          simGridRunning = false;
          simGridStartedAt = null;
          simGridProgress = null;
        })
        .catch((e) => {
          simGridLastError = e instanceof Error ? e.message : String(e);
          simGridRunning = false;
          simGridStartedAt = null;
          simGridProgress = null;
          console.error("executeSimGrid:", e);
        });
    });
    res.json({ ok: true, message: "Grid-simulaatio käynnistetty taustalla.", path: relPath });
  });

  app.get("/simulate/grid-status", (_, res) => {
    const gridProgress = readGridProgressSnapshot();
    const resumable =
      !simGridRunning &&
      gridProgress != null &&
      gridProgress.partial === true &&
      gridProgress.okResults < gridProgress.variantCount;
    res.json({
      running: simGridRunning,
      startedAt: simGridStartedAt,
      abortRequested: simGridAbortRequested,
      progress: simGridProgress,
      lastSummary: simGridLastSummary,
      lastError: simGridLastError,
      gridProgress,
      resumable,
    });
  });

  app.get("/run", (_, res) => {
    if (isSimulateInstance) {
      res.status(403).json({
        message: "Live-bottia ei voi käynnistää simulaatio-portista. Käytä live-porttia (5656) tai npm run start.",
      });
      return;
    }
    if (options.running != true) {
      options.running = true;
      const optionsInFile = parseArgs();
      optionsInFile.running = true;
      fs.writeFileSync(liveOptionsFilename, JSON.stringify(sanitizeOptionsDocument(optionsInFile), null, 2));
      hoobot();
      res.json({ message: "Hoobot started" });
    } else {
      res.json({ message: "Hoobot was already running, can't restart." });
    }
  });

  app.get("/stop", (_, res) => {
    console.log("Got command to stop hoobot");
    if (options.running == true) {
      options.running = false;
      const optionsInFile = parseArgs();
      optionsInFile.running = false;
      fs.writeFileSync(liveOptionsFilename, JSON.stringify(sanitizeOptionsDocument(optionsInFile), null, 2));
      stopHoobot();
      res.json({ message: "Hoobot stopping" });
    } else {
      res.json({ message: "Couldn't stop hoobot, since it was not running." });
    }
  });

  const maskSecretsForDisplay = (data: Record<string, unknown>): Record<string, unknown> => {
    const out = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    const exchanges = out.exchanges as Array<{ key?: string; secret?: string }> | undefined;
    if (Array.isArray(exchanges)) {
      for (const ex of exchanges) {
        if (ex && typeof ex === "object") {
          if (typeof ex.key === "string" && ex.key.length > 0) ex.key = "***";
          if (typeof ex.secret === "string" && ex.secret.length > 0) ex.secret = "***";
        }
      }
    }
    return out;
  };

  const mergeSettingsForSave = (
    current: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> => {
    const merged = JSON.parse(JSON.stringify(incoming)) as Record<string, unknown>;
    const curEx = current.exchanges as Array<{ key?: string; secret?: string }> | undefined;
    const inEx = merged.exchanges as Array<{ key?: string; secret?: string; name?: string }> | undefined;
    let liveEx: Array<{ key?: string; secret?: string; name?: string }> | undefined;
    if (isSimulateInstance && fs.existsSync(liveOptionsFilename)) {
      try {
        const rawLive = fs.readFileSync(liveOptionsFilename, "utf-8");
        const liveDoc = rawLive ? JSON.parse(rawLive) : {};
        if (Array.isArray(liveDoc.exchanges)) {
          liveEx = liveDoc.exchanges as Array<{ key?: string; secret?: string; name?: string }>;
        }
      } catch {
        // ignore
      }
    }
    if (Array.isArray(inEx)) {
      for (let i = 0; i < inEx.length; i++) {
        const n = inEx[i];
        if (!n || typeof n !== "object") continue;
        const c = curEx?.[i];
        const liveByName =
          liveEx && n.name ? liveEx.find((e) => e && e.name === n.name) : liveEx?.[i];
        const mask = (v: unknown) => v === "***" || v === "" || v == null;
        for (const field of ["secret", "key"] as const) {
          if (!mask(n[field])) continue;
          const curVal = c?.[field];
          if (typeof curVal === "string" && curVal.length > 0 && !mask(curVal)) {
            n[field] = curVal;
            continue;
          }
          const liveVal = liveByName?.[field];
          if (typeof liveVal === "string" && liveVal.length > 0 && !mask(liveVal)) {
            n[field] = liveVal;
          }
        }
      }
    }
    if (merged.simGrid === undefined && current.simGrid != null) {
      merged.simGrid = current.simGrid as Record<string, unknown>;
    } else if (merged.simGrid != null && current.simGrid != null && typeof merged.simGrid === "object") {
      const curSg = current.simGrid as Record<string, unknown>;
      const inSg = merged.simGrid as Record<string, unknown>;
      const inPath = inSg.configPath;
      if ((inPath === undefined || inPath === "" || inPath === null) && curSg.configPath != null && curSg.configPath !== "") {
        inSg.configPath = curSg.configPath;
      }
      if (inSg.enabled === undefined && curSg.enabled !== undefined) {
        inSg.enabled = curSg.enabled;
      }
    }
    return merged;
  };

  app.get("/settings", (_, res) => {
    try {
      if (isSimulateInstance) {
        const data = loadSimulateSettingsDocument();
        res.json({
          ...maskSecretsForDisplay(data),
          simulationUi: true,
        });
        return;
      }
      const readFrom = effectiveSettingsReadPath();
      if (fs.existsSync(readFrom)) {
        const raw = fs.readFileSync(readFrom, "utf-8");
        const data = raw ? JSON.parse(raw) : {};
        res.json({
          ...maskSecretsForDisplay(data as Record<string, unknown>),
          simulationUi: isSimulateInstance,
        });
      } else {
        res.json({
          debug: false,
          startTime: "",
          license: "",
          discord: {},
          exchanges: [],
          running: false,
          simulationUi: isSimulateInstance,
        });
      }
    } catch (e) {
      console.error("Error reading settings:", e);
      res.status(500).json({ error: "Failed to read settings file" });
    }
  });

  app.post("/settings", (req, res) => {
    var running = options.running;
    if (running == true) {
      stopHoobot();
    }
    let newOptions = req.body as Record<string, unknown>;
    newOptions.running = options.running;
    try {
      const mergeFrom = effectiveSettingsMergePath();
      if (fs.existsSync(mergeFrom)) {
        const raw = fs.readFileSync(mergeFrom, "utf-8");
        const current = raw ? JSON.parse(raw) : {};
        newOptions = mergeSettingsForSave(current as Record<string, unknown>, newOptions);
      }
    } catch {
      // use body as-is if merge fails
    }
    let validated = validateOptions(sanitizeOptionsDocument(newOptions as ConfigOptions) as ConfigOptions);
    if (isSimulateInstance) {
      validated = stripExchangeCredentialsForSimulatePersist(validated);
    }
    fs.writeFileSync(optionsFilename, JSON.stringify(validated, null, 2));
    Object.assign(options, validated);
    // Simulaatio-UI (SIMULATE=true, esim. portti 5657): älä käynnistä live-bottia tallennuksella
    if (options.running == true && process.env.SIMULATE !== "true") {
      hoobot();
    }
    res.json({ message: "Options updated successfully", options: maskSecretsForDisplay(validated as Record<string, unknown>) });
  });

  /** Kopioi yhden parin asetukset simulaatiolomakkeesta tai -tiedostosta → live hoobot-options.json. */
  app.post("/settings/copy-symbol-to-live", (req, res) => {
    if (!isSimulateInstance) {
      res.status(403).json({ ok: false, error: "Vain simulaatio-istunnossa (SIMULATE=true)." });
      return;
    }
    try {
      const body = req.body as { exchangeName?: string; symbol?: Record<string, unknown> };
      const incoming = body.symbol && typeof body.symbol === "object" ? body.symbol : null;
      const symName = incoming?.name != null ? String(incoming.name).trim() : "";
      if (!incoming || !symName) {
        res.status(400).json({ ok: false, error: "Puuttuu symbol.name tai symbol-objekti." });
        return;
      }
      if (!fs.existsSync(liveOptionsFilename)) {
        res.status(400).json({ ok: false, error: "Live-asetustiedostoa ei löydy: " + liveOptionsFilename });
        return;
      }
      const rawLive = fs.readFileSync(liveOptionsFilename, "utf-8");
      const liveDoc = (rawLive ? JSON.parse(rawLive) : {}) as Record<string, unknown>;
      const copySymPol = readSimToLiveMergePolicy(liveDoc);
      const exchanges = liveDoc.exchanges as ExchangeOptions[] | undefined;
      if (!Array.isArray(exchanges) || exchanges.length === 0) {
        res.status(400).json({ ok: false, error: "Live-konfigissa ei ole pörssejä." });
        return;
      }
      const wantEx = (body.exchangeName ?? "").toString().trim();
      let exIdx = wantEx ? exchanges.findIndex((e) => e && e.name === wantEx) : 0;
      if (exIdx < 0 && wantEx) {
        res.status(400).json({ ok: false, error: `Pörssiä "${wantEx}" ei löydy live-asetuksista.` });
        return;
      }
      if (exIdx < 0) exIdx = 0;
      const ex = exchanges[exIdx];
      if (!ex || !Array.isArray(ex.symbols)) {
        res.status(400).json({ ok: false, error: "Live-pörssillä ei ole symbolilistaa." });
        return;
      }
      const syms = [...ex.symbols];
      const sIdx = syms.findIndex((s) => s && s.name === symName);
      const existingSym = sIdx >= 0 ? syms[sIdx] : undefined;
      const merged = mergeIncomingSymbolPreserveLiveRuntime(incoming, existingSym, copySymPol);
      const asSym = merged as unknown as SymbolOptions;
      if (sIdx >= 0) syms[sIdx] = asSym;
      else syms.push(asSym);
      syncTakeProfitRuntimeFromConfig(sIdx >= 0 ? syms[sIdx] : asSym);
      ex.symbols = syms as SymbolOptions[];

      fs.writeFileSync(liveOptionsFilename, JSON.stringify(sanitizeOptionsDocument(liveDoc as ConfigOptions), null, 2));
      res.json({
        ok: true,
        message: `Parin ${symName} asetukset kirjoitettiin live-tiedostoon (${path.basename(liveOptionsFilename)}).`,
      });
    } catch (e) {
      console.error("copy-symbol-to-live:", e);
      res.status(500).json({ ok: false, error: "Kopiointi epäonnistui." });
    }
  });

  const restartLiveHoobotFromDisk = (): void => {
    stopHoobot();
    const fresh = validateOptions(JSON.parse(JSON.stringify(parseArgs())) as ConfigOptions);
    fresh.running = true;
    fs.writeFileSync(liveOptionsFilename, JSON.stringify(sanitizeOptionsDocument(fresh), null, 2));
    Object.assign(options, fresh);
    void hoobot().catch((err) => console.error("hoobot restart:", err));
  };

  const readPersistedBaselineExchanges = (snapFromBody: string): ConfigOptions | undefined => {
    if (snapFromBody && existsSync(snapFromBody)) {
      const rawSnap = fs.readFileSync(snapFromBody, "utf-8");
      return rawSnap ? (JSON.parse(rawSnap) as ConfigOptions) : undefined;
    }
    if (existsSync(simulateLastResultFile)) {
      const rawLast = fs.readFileSync(simulateLastResultFile, "utf-8");
      const parsed = rawLast ? (JSON.parse(rawLast) as PersistedSimulationResult) : null;
      return parsed?.baselineConfig;
    }
    return undefined;
  };

  registerSettingsAdminRoutes(app, {
    isSimulateInstance,
    liveOptionsFilename,
    optionsFilename,
    simToLivePushCors,
    applySummaryVariantToHoobotJsonFile,
    restartLiveHoobotFromDisk,
    readPersistedBaselineExchanges,
  });

  /** Take profit -runtime (huippu, armed) symbolille — treidauksen tilan tarkistus UI:lle. */
  app.get("/trading/tp-state", (req, res) => {
    const symbolName = String(req.query.symbol ?? "").trim();
    if (!symbolName) {
      res.status(400).json({ ok: false, error: "Query parameter symbol is required." });
      return;
    }
    const symbolKey = toSymbolKey(symbolName);
    let sym: SymbolOptions | undefined;
    for (const ex of options.exchanges ?? []) {
      sym = ex.symbols?.find((s) => s && toSymbolKey(s.name) === symbolKey);
      if (sym) break;
    }
    if (!sym) {
      res.status(404).json({ ok: false, error: `Symbol ${symbolName} not found in running options.` });
      return;
    }
    res.json({
      ok: true,
      symbol: sym.name,
      takeProfit: {
        current: sym.takeProfit?.current ?? 0,
        runtimeSell: getTakeProfitRuntimeState(symbolKey, "sell"),
        runtimeBuy: getTakeProfitRuntimeState(symbolKey, "buy"),
      },
    });
  });

  /** Kryptot-sivun hinnat (CoinGecko; CryptoCompare vaatii API-avaimen). */
  app.get("/api/crypto/prices", async (_req, res) => {
    try {
      if (cryptoPricesCache && Date.now() - cryptoPricesCache.at < CRYPTO_PRICES_CACHE_MS) {
        res.json(cryptoPricesCache.data);
        return;
      }

      const ids = [...new Set(Object.values(CRYPTO_COINGECKO_IDS))].join(",");
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eur&include_24hr_change=true`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        res.status(502).json({ error: `Hintapalvelu vastasi ${response.status}` });
        return;
      }

      const coingecko = (await response.json()) as Record<string, Record<string, number>>;
      const RAW: Record<string, Record<string, { PRICE: number; CHANGEPCT24HOUR: number }>> = {};
      for (const [symbol, coinId] of Object.entries(CRYPTO_COINGECKO_IDS)) {
        const row = coingecko[coinId];
        if (!row) continue;
        RAW[symbol] = {
          USD: {
            PRICE: Number(row.usd),
            CHANGEPCT24HOUR: Number(row.usd_24h_change ?? 0),
          },
          EUR: {
            PRICE: Number(row.eur),
            CHANGEPCT24HOUR: Number(row.eur_24h_change ?? 0),
          },
        };
      }

      if (Object.keys(RAW).length === 0) {
        res.status(502).json({ error: "Hintapalvelusta ei saatu kryptohintoja." });
        return;
      }

      const data = { RAW };
      cryptoPricesCache = { at: Date.now(), data };
      res.json(data);
    } catch (e) {
      logger.error("Error in /api/crypto/prices", e);
      res.status(500).json({ error: "Hintojen haku epaonnistui." });
    }
  });

  // Start the server and return the Express app instance
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, () => {
      logger.info(`Open Hoobot at http://localhost:${PORT}${isSimulateInstance ? " (simulaatio-istunto)" : ""}`);
      if (isSimulateInstance) {
        console.log(
          "[simulate] Palvelin odottaa. Käynnistä ajo UI:ssa (Simulaatio → Run Simulation) tai POST /simulate/start."
        );
        console.log(
          "[simulate] Eteneminen: SIM_PROGRESS_CONSOLE=false poistaa replay-rivit terminaalista. " +
            "Jos näyttö jumittaa idle-herätyksessä: prioriteetti on BELOW_NORMAL; heap 4GB (package.json)."
        );
      }
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[Hoobot] Portti ${PORT} on jo käytössä. Pysäytä vanha prosessi tai käytä PORT=5658 npm run simulate:start`
        );
        if (!isSimulateInstance) {
          process.exit(1);
        }
      }
      reject(err);
    });
  });

  return app;
};

const handleRejection = (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  let extra: unknown = undefined;

  if (!(reason instanceof Error)) {
    extra = reason;
  }

  const transient = isTransientNetworkError(err);

  try {
    logToFile(
      "./logs/error.log",
      JSON.stringify(
        {
          message: err.message,
          stack: err.stack,
          reason: extra,
          transient,
        },
        null,
        4
      )
    );
  } catch {
    // ignore
  }

  if (transient) {
    console.warn(
      `[Hoobot] Verkko/WebSocket-virhe (botti jatkaa): ${err.message}`
    );
    return;
  }

  if (extra && typeof extra === "object") {
    console.error("Unhandled error object:", extra);
  } else {
    console.error("Unhandled error:", err);
  }
};

const handleUncaughtException = (reason: unknown) => {
  handleRejection(reason);
  process.exit(1);
};

process.on("unhandledRejection", handleRejection);
process.on("uncaughtException", handleUncaughtException);

void (async () => {
  if (process.env.SIMULATE !== "true") {
    const lockPort = Number(process.env.PORT || 5656);
    if (!(await acquireLiveProcessLock(lockPort))) {
      process.exit(1);
    }
  }

  if (process.env.NOWEBUI === "true") {
    hoobot().catch(handleRejection);
    return;
  }

  // Älä autokäynnistä live-kauppaa simulaatio-istunnossa (SIMULATE=true, oma portti)
  if (options.running && process.env.SIMULATE !== "true") {
    hoobot().catch(handleRejection);
  }
  webServer().catch((err: unknown) => {
    handleRejection(err);
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "EADDRINUSE" && process.env.SIMULATE !== "true") {
      process.exit(1);
    }
  });
})();
