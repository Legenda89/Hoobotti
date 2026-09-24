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

import { CandlestickInterval, ConfigOptions, SymbolOptions, getMinutesFromInterval, toSymbolKey } from "../Utilities/Args";
import { resolveSimYieldConfig, yieldToEventLoop } from "../Utilities/simulateProcessGuard";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import AdmZip from "adm-zip";
import path from "path";
import { Exchange, isBinance, isNonKYC } from "./Exchange";
import { NonKYCCandles, NonKYCResponse } from "./NonKYC/NonKYC";
import { logToFile } from "../Utilities/LogToFile";
import { withRetry } from "../Utilities/Retry";
import { markSymbolCandleSubscribed, markSymbolCandleUpdate } from "../Utilities/botHealth";

export interface Candlesticks {
  [symbol: string]: {
    [time: string]: Candlestick[];
  };
}

export interface Candlestick {
  symbol: string;
  interval: string;
  type: string;
  time: number;
  /** Candle period start time (ms). Used to detect new candle vs update. */
  startTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  trades: number;
  volume: number;
  quoteVolume: number;
  buyVolume: number;
  quoteBuyVolume: number;
  isFinal: boolean;
  [key: string]: string | number | boolean | undefined;
}

export async function getLastCandlesticks(
  exchange: Exchange,
  symbol: string,
  interval: CandlestickInterval,
  limit: number = 500
): Promise<Candlestick[]> {
  return new Promise<Candlestick[]>(async (resolve, _reject) => {
    if (isBinance(exchange)) {
      exchange.candlesticks(
        toSymbolKey(symbol),
        interval,
        (_error: any, ticks: any, symbol: string, interval: string) => {
	if (ticks === undefined || !Array.isArray(ticks)) {
		return resolve([]);
          }
          const parsedData: Candlestick[] = ticks.map((candle: string[]) => {
            const openTime = parseFloat(candle[0]);
            return {
              symbol: symbol,
              interval: interval,
              type: candle[8],
              time: openTime,
              startTime: openTime,
              open: parseFloat(candle[1]),
              high: parseFloat(candle[2]),
              low: parseFloat(candle[3]),
              close: parseFloat(candle[4]),
              trades: parseFloat(candle[9]),
              volume: parseFloat(candle[5]),
              quoteVolume: parseFloat(candle[7]),
              buyVolume: parseFloat(candle[10]),
              quoteBuyVolume: parseFloat(candle[11]),
              isFinal: Boolean(candle[12]) && candle[12] !== "false" && candle[12] !== "0",
            };
          });
          resolve(parsedData);
        },
        { limit: limit }
      );
    } else if (isNonKYC(exchange)) {
      const candlesticks = await exchange.getCandles(symbol, null, null, getMinutesFromInterval(interval), limit, 1);
      const parsedData: Candlestick[] = candlesticks.bars.map(
        (candle: { time: number; close: number; open: number; high: number; low: number; volume: number }) => ({
          symbol: symbol,
          interval: interval,
          type: "kline",
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          trades: 0,
          volume: candle.volume,
          quoteVolume: 0,
          buyVolume: 0,
          quoteBuyVolume: 0,
          isFinal: true,
        })
      );
      resolve(parsedData);
    }
  });
}

export const listenForCandlesticks = async (
  exchange: Exchange,
  symbol: string,
  intervals: CandlestickInterval[],
  candleStore: Candlesticks,
  historyLength: number,
  symbolOptions: SymbolOptions,
  callback: (candlesticks: Candlesticks) => Promise<void>
): Promise<void> => {
  console.log("Start listening for Candlesticks");
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error(
      `listenForCandlesticks: symbol="${symbol}" puuttuva tai virheellinen timeframes (${String(
        intervals
      )}). Tarkista symbolin konfigissa taulukko \`timeframes\` — grid/sim-siirto ei säilyttänyt aiempia timeframeja.`
    );
  }
  const maxCandlesticks = 10000;
  let timeframes = [...intervals];
  if (isBinance(exchange) && symbolOptions.trend?.enabled) {
    if (!intervals.includes(symbolOptions.trend?.timeframe!)) {
      timeframes.push(symbolOptions.trend?.timeframe!);
    }
  }
  markSymbolCandleSubscribed(symbol, timeframes);
  for (let i = 0; i < timeframes.length; i++) {
    if (isBinance(exchange)) {
      const websocket = exchange.websockets;
      symbol = toSymbolKey(symbol);
      websocket.candlesticks(symbol, timeframes[i], async (candlestick: { e: any; E: any; s: any; k: any }) => {
        let { e: eventType, E: eventTime, s: symbol, k: ticks } = candlestick;
        let {
          t: startTimeMs,
          o: open,
          h: high,
          l: low,
          c: close,
          v: volume,
          n: trades,
          i: interval,
          x: isFinal,
          q: quoteVolume,
          V: buyVolume,
          Q: quoteBuyVolume,
        } = ticks;
        const startTime = typeof startTimeMs === "number" ? startTimeMs : parseFloat(String(startTimeMs));
        const newCandlestick: Candlestick = {
          symbol: symbol,
          interval: interval,
          type: eventType,
          time: parseFloat(eventTime),
          startTime,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          trades: parseFloat(trades),
          volume: parseFloat(volume),
          quoteVolume: parseFloat(quoteVolume),
          buyVolume: parseFloat(buyVolume),
          quoteBuyVolume: parseFloat(quoteBuyVolume),
          isFinal: Boolean(isFinal === true || isFinal === "true" || isFinal === 1),
        };
        if (candleStore[symbol] === undefined) {
          const oldCandlesticks = await withRetry(() =>
            getLastCandlesticks(exchange, symbol, timeframes[i], historyLength)
          );
          candleStore[symbol] = {
            [timeframes[i]]: [...oldCandlesticks, newCandlestick],
          };
        } else if (candleStore[symbol][timeframes[i]] === undefined) {
          candleStore[symbol][timeframes[i]] = [
            ...(await withRetry(() =>
              getLastCandlesticks(exchange, symbol, timeframes[i], historyLength)
            )),
            newCandlestick,
          ];
        } else if (newCandlestick.isFinal === true) {
          candleStore[symbol][timeframes[i]].push(newCandlestick);
        } else {
          const arr = candleStore[symbol][timeframes[i]];
          const lastCandle = arr[arr.length - 1];
          const lastStart = lastCandle?.startTime ?? lastCandle?.time;
          const isNewPeriod = lastStart !== undefined && newCandlestick.startTime !== undefined && lastStart !== newCandlestick.startTime;
          if (isNewPeriod) {
            arr.push(newCandlestick);
          } else {
            arr[arr.length - 1] = newCandlestick;
          }
        }
        const arrForSlice = candleStore[symbol]?.[timeframes[i]];
        if (arrForSlice?.length > maxCandlesticks) {
          candleStore[symbol][timeframes[i]] = arrForSlice.slice(-maxCandlesticks);
        }
        markSymbolCandleUpdate(symbol);
        if (!(symbolOptions.stopLoss?.hit === true && symbolOptions.stopLoss?.stopTrading === true)) {
          await callback(candleStore);
        } else {
          websocket.terminate();
        }
      });
    } else if (isNonKYC(exchange)) {
      console.log("Subscribe to candles");
      exchange.subscribeCandles(
        symbol,
        getMinutesFromInterval(timeframes[i]),
        async (response: NonKYCResponse) => {
          console.log("Subscribe Candles callback called!");
          if (response.method === "updateCandles") {
            const candles = (response.params as NonKYCCandles).data;
            if (candles.length < 1) {
              return;
            }
            const candle = candles[0];
            const timeOfCandle = new Date(candle.timestamp).getTime();
            // const currentTime = new Date().getTime() - (30 * 1000);
            let isFinal = false;
            if (
              candleStore[toSymbolKey(symbol)] !== undefined &&
              candleStore[toSymbolKey(symbol)][timeframes[i]] !== undefined &&
              candleStore[toSymbolKey(symbol)][timeframes[i]].length > 0
            ) {
              const previousCandle =
                candleStore[toSymbolKey(symbol)][timeframes[i]][
                  candleStore[toSymbolKey(symbol)][timeframes[i]].length - 1
                ];
              if (previousCandle.time !== timeOfCandle) {
                isFinal = true;
              }
            } else if (candleStore[toSymbolKey(symbol)] === undefined) {
              isFinal = true;
            }
            const newCandlestick: Candlestick = {
              symbol: symbol,
              interval: timeframes[i],
              type: "",
              time: timeOfCandle,
              startTime: timeOfCandle,
              open: parseFloat(candle.open),
              high: parseFloat(candle.max),
              low: parseFloat(candle.min),
              close: parseFloat(candle.close),
              trades: 0,
              volume: parseFloat(candle.volume),
              quoteVolume: 0,
              buyVolume: 0,
              quoteBuyVolume: 0,
              isFinal: isFinal,
            };
            if (candleStore[toSymbolKey(symbol)] === undefined) {
              candleStore[toSymbolKey(symbol)] = {
                [timeframes[i]]: [
                  ...(await withRetry(() =>
                    getLastCandlesticks(exchange, symbol, timeframes[i], historyLength)
                  )),
                  newCandlestick,
                ],
              };
            } else if (candleStore[toSymbolKey(symbol)][timeframes[i]] === undefined) {
              candleStore[toSymbolKey(symbol)][timeframes[i]] = [
                ...(await withRetry(() =>
                  getLastCandlesticks(exchange, symbol, timeframes[i], historyLength)
                )),
                newCandlestick,
              ];
            } else if (newCandlestick.isFinal === true) {
              candleStore[toSymbolKey(symbol)][timeframes[i]].push(newCandlestick);
            } else {
              candleStore[toSymbolKey(symbol)][timeframes[i]][
                candleStore[toSymbolKey(symbol)][timeframes[i]].length - 1
              ] = newCandlestick;
            }
            const arrForSliceN = candleStore[toSymbolKey(symbol)]?.[timeframes[i]];
            if (arrForSliceN?.length > maxCandlesticks) {
              candleStore[toSymbolKey(symbol)][timeframes[i]] = arrForSliceN.slice(-maxCandlesticks);
            }
            if (!(symbolOptions.stopLoss?.hit === true && symbolOptions.stopLoss?.stopTrading === true)) {
              markSymbolCandleUpdate(symbol);
              await callback(candleStore);
            } else {
              exchange.unsubscribeCandles(symbol, getMinutesFromInterval(timeframes[i]));
              exchange.unsubscribeTicker(symbol);
            }
          }
        },
        10
      );
    }
  }
};

interface Candlerow {
  opentime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closetime: number;
  quoteVolume: number;
  trades: number;
  takerQtyBase: number;
  takerQtyQuote: number;
  unused: number;
}

/**
 * Normalisoi UNIX-aikaleiman millisekunneiksi.
 * Tukee sekunteja, millisekunteja, mikrosekunteja ja nanosekunteja.
 */
const normalizeUnixToMs = (ts: number): number => {
  if (!Number.isFinite(ts) || ts <= 0) return ts;
  // ns (19) -> ms
  if (ts >= 1e18) return Math.trunc(ts / 1e6);
  // us (16) -> ms
  if (ts >= 1e15) return Math.trunc(ts / 1e3);
  // ms (13) -> ms
  if (ts >= 1e12) return Math.trunc(ts);
  // s (10) -> ms
  if (ts >= 1e9) return Math.trunc(ts * 1e3);
  return Math.trunc(ts);
};

export const readCsvFile = async (filePath: string): Promise<Candlerow[]> => {
  const data = readFileSync(filePath, { encoding: "utf8" });
  const lines = data.split("\n");
  const rows: Candlerow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(",");
    if (values.length < 5) continue;
    const open = parseFloat(values[1]);
    const high = parseFloat(values[2]);
    const low = parseFloat(values[3]);
    const close = parseFloat(values[4]);
    if (Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) continue;
    const openTimeRaw = parseInt(values[0], 10);
    const closeTimeRaw = parseInt(values[7], 10);
    const row: Candlerow = {
      opentime: normalizeUnixToMs(openTimeRaw),
      open,
      high,
      low,
      close,
      volume: parseFloat(values[5]),
      quoteVolume: parseFloat(values[6]),
      closetime: normalizeUnixToMs(closeTimeRaw),
      trades: parseInt(values[8], 10),
      takerQtyBase: parseFloat(values[9]),
      takerQtyQuote: parseFloat(values[10]),
      unused: parseInt(values[11], 10),
    };
    rows.push(row);
  }
  return rows;
};

export const downloadAndExtractZipFile = async (url: string, destinationPath: string): Promise<boolean | string> => {
  const response = await fetch(url);
  if (!response.ok) {
    return "404 NOT FOUND";
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const zipFilePath = path.join(destinationPath, "downloaded.zip");
  writeFileSync(zipFilePath, buffer);
  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(destinationPath, true);
  unlinkSync(zipFilePath);
  return true;
};

const addLeadingZero = (n: number) => {
  return n < 10 ? `0${n}` : `${n}`;
};

function shellSortCandlesticksByTime(nums: Candlestick[]): Candlestick[] {
  const n = nums.length;
  let gap = Math.floor(n / 2);
  while (gap > 0) {
    for (let i = gap; i < n; i++) {
      const temp = nums[i];
      let j = i;
      while (j >= gap && nums[j - gap].time > temp.time) {
        nums[j] = nums[j - gap];
        j -= gap;
      }
      nums[j] = temp;
    }
    gap = Math.floor(gap / 2);
  }
  return nums;
}

/** Ensimmäinen vuosi, josta Binance Vision -kuukausidata haetaan simulaatiossa. */
export const SIMULATION_HISTORICAL_START_YEAR = 2020;

function minMaxCandlestickTime(candles: Candlestick[]): { min: number; max: number } {
  if (candles.length === 0) {
    return { min: 0, max: 0 };
  }
  let minT = candles[0].time;
  let maxT = candles[0].time;
  for (let i = 1; i < candles.length; i++) {
    const t = candles[i].time;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  return { min: minT, max: maxT };
}

/** Simulaatiohistorian esiasetukset (vuosina; 1/12 ≈ 1 kk). */
export const SIMULATION_HISTORY_ONE_MONTH_YEARS = 1 / 12;
export const SIMULATION_HISTORY_SIX_MONTHS_YEARS = 0.5;

export const formatSimulationHistoryPeriodFi = (years: number | undefined | null): string => {
  if (years == null || typeof years !== "number" || !Number.isFinite(years) || years <= 0) {
    return "koko ladattu historia";
  }
  if (Math.abs(years - SIMULATION_HISTORY_ONE_MONTH_YEARS) < 1e-6) {
    return "viimeiset 1 kk";
  }
  if (Math.abs(years - SIMULATION_HISTORY_SIX_MONTHS_YEARS) < 1e-6) {
    return "viimeiset 6 kk";
  }
  const rounded = Math.round(years * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    const n = Math.round(rounded);
    return n === 1 ? "viimeiset 1 vuosi" : `viimeiset ${n} vuotta`;
  }
  return `viimeiset ${years} v`;
};

/**
 * Rajaa simulaation kynttilät viimeisiin `years` vuoteen (avausaika >= nyt − vuodet).
 * Murto-osat sallittu (esim. 1/12 = 1 kk). Tyhjä / ei-numero / ≤ 0 = palauta kaikki.
 */
export const filterCandlesticksBySimulationHistoryYears = (
  candles: Candlestick[],
  years: number | undefined | null
): Candlestick[] => {
  if (candles.length === 0) {
    return candles;
  }
  if (years == null || typeof years !== "number" || !Number.isFinite(years) || years <= 0) {
    return candles;
  }
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - years * msPerYear;
  return candles.filter((c) => c.time >= cutoff);
};

/**
 * Kuvaa konsoliin (fi), mitä kynttiläjaksoa simulaatio käyttää: koko historia vs. viimeiset N vuotta.
 */
export const formatSimulationCandleHistoryFi = (
  candles: Candlestick[],
  requestedHistoryYears: number | undefined | null
): string => {
  if (candles.length === 0) {
    return "Simulaatio: ei kynttilöitä (tyhjä joukko rajauksen jälkeen). Tarkista data tai simulationHistoryYears.";
  }
  const { min, max } = minMaxCandlestickTime(candles);
  const minD = new Date(min).toLocaleString("fi-FI");
  const maxD = new Date(max).toLocaleString("fi-FI");
  const spanYears = (max - min) / (365.25 * 24 * 60 * 60 * 1000);
  const rows = candles.length;
  const useWindow =
    requestedHistoryYears != null &&
    typeof requestedHistoryYears === "number" &&
    Number.isFinite(requestedHistoryYears) &&
    requestedHistoryYears > 0;

  if (useWindow) {
    return (
      `Simulaatio: kynttilät — ${formatSimulationHistoryPeriodFi(requestedHistoryYears)} (rajattu). ` +
      `Vanhin: ${minD} — uusin: ${maxD}. ` +
      `Aikajänne ~${spanYears.toFixed(1)} v, rivejä ${rows}.`
    );
  }
  return (
    `Simulaatio: kynttilät — koko ladattu historia (Binance Vision ${SIMULATION_HISTORICAL_START_YEAR} →). ` +
    `Vanhin: ${minD} — uusin: ${maxD}. ` +
    `Aikajänne ~${spanYears.toFixed(1)} v, rivejä ${rows}.`
  );
};

export const downloadHistoricalCandlesticks = async (
  symbols: string[],
  intervals: string[],
  onProgress?: (info: {
    symbol: string;
    symbolIndex: number;
    symbolTotal: number;
    interval: string;
    intervalIndex: number;
    intervalTotal: number;
    year: number;
    month: number;
    monthIndex: number;
    monthTotal: number;
  }) => void
): Promise<Candlestick[]> => {
  let allCandlesticks: Candlestick[] = [];
  const symTotal = symbols?.length ?? 0;
  for (let symbolIndex = 0; symbolIndex < symbols?.length; symbolIndex++) {
    console.log(
      `Downloading symbol ${symbolIndex + 1}/${symTotal}: ${symbols[symbolIndex]} candlesticks.`
    );
    for (let intervalIndex = 0; intervalIndex < intervals?.length; intervalIndex++) {
      let currentYear = new Date().getFullYear();
      let currentMonth = new Date().getMonth() + 1;
      const startYear = SIMULATION_HISTORICAL_START_YEAR;
      const startMonth = 1;
      const monthTotal = (currentYear - startYear) * 12 + (currentMonth - startMonth) + 1;
      let monthFileIndex = 0;
      for (let year = startYear; year <= currentYear; year++) {
        for (
          let month = year === startYear ? startMonth : 1;
          month <= (year === currentYear ? currentMonth : 12);
          month++
        ) {
          monthFileIndex++;
          const formattedYear = year.toString();
          const formattedMonth = addLeadingZero(month);
          onProgress?.({
            symbol: symbols[symbolIndex],
            symbolIndex: symbolIndex + 1,
            symbolTotal: symTotal,
            interval: intervals[intervalIndex],
            intervalIndex: intervalIndex + 1,
            intervalTotal: intervals.length,
            year,
            month,
            monthIndex: monthFileIndex,
            monthTotal,
          });
          if (monthFileIndex === 1 || monthFileIndex % 6 === 0) {
            console.log(
              `  … ${symbols[symbolIndex]} ${intervals[intervalIndex]} ${formattedYear}-${formattedMonth} (kuukausi ${monthFileIndex})`
            );
          }
          const url = `https://data.binance.vision/data/spot/monthly/klines/${symbols[symbolIndex]
            .split("/")
            .join("")
            .toLocaleUpperCase()}/${intervals[intervalIndex]}/${symbols[symbolIndex]
            .split("/")
            .join("")
            .toLocaleUpperCase()}-${intervals[intervalIndex]}-${formattedYear}-${formattedMonth}.zip`;
          const destinationPath = "./candlestore/";
          if (!existsSync(destinationPath)) {
            mkdirSync(destinationPath);
            console.log(`Directory '${destinationPath}' created successfully.`);
          }
          const filePath = `./candlestore/${toSymbolKey(symbols[symbolIndex]).toLocaleUpperCase()}-${
            intervals[intervalIndex]
          }-${formattedYear}-${formattedMonth}.csv`;
          if (!existsSync(filePath)) {
            const dlresult = await downloadAndExtractZipFile(url, destinationPath);
            console.log(`Downloaded file ${url}: ${dlresult}`);
          }
          if (existsSync(filePath)) {
            const candledata = await readCsvFile(filePath);
            for (let candledataIndex = 0; candledataIndex < candledata.length; candledataIndex++) {
              if (candledataIndex > 0 && candledataIndex % 10000 === 0) {
                // Avoid long UI/network starvation while parsing huge CSV chunks.
                await yieldToEventLoop(candledataIndex % 40000 === 0);
              }
              const row = candledata[candledataIndex];
              const candlestick: Candlestick = {
                symbol: symbols[symbolIndex] != null ? toSymbolKey(symbols[symbolIndex]) : "",
                interval: intervals[intervalIndex],
                type: "",
                time: row.opentime,
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                trades: row.trades,
                volume: row.volume,
                quoteVolume: row.quoteVolume,
                buyVolume: row.takerQtyBase,
                quoteBuyVolume: row.takerQtyQuote,
                isFinal: true,
              };
              allCandlesticks.push(candlestick);
            }
          }
        }
      }
    }
    console.log(`Downloaded symbol ${symbols[symbolIndex]} candlesticks.`);
  }
  console.log(`Sorting ${allCandlesticks.length} candlesticks.`);
  allCandlesticks = shellSortCandlesticksByTime(allCandlesticks);
  console.log(`Candlesticks sorted (${allCandlesticks.length} rows).`);
  return allCandlesticks;
};

/** Optional progress logging for simulation replay (Finnish console messages). */
export type SimulateListenProgress = {
  passIndex: number;
  passTotal: number;
  focusSymbol: string;
};

/** Kynttiläreplayn eteneminen (UI / status-API). */
export type SimulateListenCandleProgress = {
  passIndex: number;
  passTotal: number;
  focusSymbol: string;
  done: number;
  total: number;
};

export type SimulateListenOutcome = {
  userAborted: boolean;
  /** Seuraava käsiteltävä kynttiläindeksi tässä erässä, jos käyttäjä keskeytti. */
  abortedAtCandleIndex?: number;
  /** Stop-loss / stopTrading katkaisi replayn (ei käyttäjän abort). */
  stopTradingHalted?: boolean;
  /** Seuraava indeksi erässä pysähdyksen hetkellä (checkpoint-tyylinen; jatko ei yleensä tarkoitu). */
  stopTradingAtCandleIndex?: number;
};

export const simulateListenForCandlesticks = async (
  symbols: string[],
  candlesticks: Candlestick[],
  candleStore: Candlesticks,
  options: ConfigOptions,
  callback: (symbol: string, interval: string, candlesticks: Candlesticks) => Promise<void>,
  progress?: SimulateListenProgress,
  shouldAbort?: () => boolean,
  onCandleProgress?: (info: SimulateListenCandleProgress) => void,
  startCandleIndex?: number,
  /** Per erä (esim. symbolOptions.stopLoss) — sama idea kuin live-kuuntelussa. */
  isStopTrading?: () => boolean
): Promise<SimulateListenOutcome> => {
  const maxCandlesticks = 1_000_000;
  const yieldCfg = resolveSimYieldConfig();
  const yieldEveryCandles = yieldCfg.everyCandles;
  const yieldEveryMs = yieldCfg.everyMs;
  const timerEveryNYields = yieldCfg.timerEveryNYields;
  const total = candlesticks.length;
  const start = Math.max(0, Math.floor(startCandleIndex ?? 0));
  /** ~25 progress lines max for large runs */
  const reportEvery = Math.max(1, Math.ceil(total / 25));
  let lastReported = start > 0 ? start - 1 : -1;
  let replayAborted = false;
  let abortedAtCandleIndex: number | undefined;
  let stopTradingHalted = false;
  let stopTradingAtCandleIndex: number | undefined;
  let lastYieldAt = Date.now();
  let yieldCount = 0;

  const stopTradingActive = (): boolean => {
    if (typeof isStopTrading === "function" && isStopTrading()) return true;
    return options.stopLossHit === true && options.stopLossStopTrading === true;
  };
  if (progress && total > 0) {
    if (start > 0) {
      console.log(
        `Simulaatio: erä ${progress.passIndex}/${progress.passTotal} (${progress.focusSymbol}) — jatketaan kynttilästä ${start + 1}/${total}.`
      );
    } else {
      console.log(
        `Simulaatio: erä ${progress.passIndex}/${progress.passTotal} (${progress.focusSymbol}) — käydään läpi ${total} kynttilätapahtumaa.`
      );
    }
    onCandleProgress?.({
      passIndex: progress.passIndex,
      passTotal: progress.passTotal,
      focusSymbol: progress.focusSymbol,
      done: start,
      total,
    });
  }
  for (let candleIndex = start; candleIndex < candlesticks.length; candleIndex++) {
    const now = Date.now();
    if (
      (candleIndex > 0 && candleIndex % yieldEveryCandles === 0) ||
      now - lastYieldAt >= yieldEveryMs
    ) {
      // setImmediate pitää HTTP:n elossa; ajoittainen setTimeout(1) antaa Windows DWM:lle CPU-aikaa.
      yieldCount += 1;
      await yieldToEventLoop(yieldCount % timerEveryNYields === 0);
      lastYieldAt = Date.now();
    }
    if (shouldAbort && shouldAbort()) {
      console.log("Simulaatio: keskeytys pyydetty — lopetetaan kynttilöiden läpikäynti.");
      replayAborted = true;
      abortedAtCandleIndex = candleIndex;
      if (progress && total > 0) {
        onCandleProgress?.({
          passIndex: progress.passIndex,
          passTotal: progress.passTotal,
          focusSymbol: progress.focusSymbol,
          done: candleIndex,
          total,
        });
      }
      break;
    }
    const candlestick = candlesticks[candleIndex];
    const symbol = candlesticks[candleIndex]?.symbol;
    const interval = candlesticks[candleIndex]?.interval;
    if (!(symbol in candleStore)) {
      candleStore[symbol] = {};
    }
    if (!(interval in candleStore[symbol])) {
      candleStore[symbol][interval] = [];
    }
    candleStore[symbol][interval].push(candlestick);
    if (candleStore[symbol][interval]?.length > maxCandlesticks) {
      candleStore[symbol][interval] = candleStore[symbol][interval].slice(-maxCandlesticks);
    }
    if (progress && total > 0) {
      const done = candleIndex + 1;
      if (done === 1 || done === total || done - lastReported >= reportEvery) {
        const pct = ((done / total) * 100).toFixed(1);
        console.log(
          `Simulaatio: erä ${progress.passIndex}/${progress.passTotal} (${progress.focusSymbol}) — kynttilät ${done}/${total} (${pct} %).`
        );
        onCandleProgress?.({
          passIndex: progress.passIndex,
          passTotal: progress.passTotal,
          focusSymbol: progress.focusSymbol,
          done,
          total,
        });
        lastReported = done;
      }
    }
    if (candleStore[symbol][interval]?.length > 250) {
      let splittedSymbol = "";
      for (let symbolsIndex = 0; symbolsIndex < symbols.length; symbolsIndex++) {
        if (symbol === toSymbolKey(symbols[symbolsIndex])) {
          splittedSymbol = symbols[symbolsIndex];
          break;
        }
      }
      if (!stopTradingActive()) {
        await callback(splittedSymbol, interval, candleStore);
      } else {
        stopTradingHalted = true;
        stopTradingAtCandleIndex = candleIndex + 1;
        break;
      }
    }
  }
  /**
   * Callback laukeaa vain kun sarjan pituus > 250. Jos erä päättyy 1…250 kynttilään, algoritmia ei kutsuttaisi —
   * replay jää viimeiseltä pätkältä ajamatta (checkpoint + tulos väärin).
   */
  if (!replayAborted && !stopTradingHalted && total > 0) {
    const focus = progress?.focusSymbol ?? symbols[0];
    if (focus && !stopTradingActive()) {
      const sk = toSymbolKey(focus);
      const node = candleStore[sk];
      if (node) {
        for (const interval of Object.keys(node)) {
          const len = node[interval]?.length ?? 0;
          if (len > 0 && len <= 250) {
            await callback(focus, interval, candleStore);
          }
        }
      }
    }
  }
  if (progress && total > 0 && !replayAborted && !stopTradingHalted) {
    console.log(
      `Simulaatio: erä ${progress.passIndex}/${progress.passTotal} (${progress.focusSymbol}) — kynttilöiden läpikäynti valmis.`
    );
    onCandleProgress?.({
      passIndex: progress.passIndex,
      passTotal: progress.passTotal,
      focusSymbol: progress.focusSymbol,
      done: total,
      total,
    });
  } else if (stopTradingHalted && progress && total > 0) {
    console.log(
      `Simulaatio: erä ${progress.passIndex}/${progress.passTotal} (${progress.focusSymbol}) — replay pysäytettiin (stopTrading / stop-loss).`
    );
  }
  return {
    userAborted: replayAborted,
    abortedAtCandleIndex,
    ...(stopTradingHalted
      ? { stopTradingHalted: true as const, stopTradingAtCandleIndex }
      : {}),
  };
};
