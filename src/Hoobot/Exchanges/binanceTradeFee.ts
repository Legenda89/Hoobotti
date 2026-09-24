/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import { toSymbolKey, type ExchangeOptions, type SymbolOptions } from "../Utilities/Args";
import {
  markDataFetched,
  shouldFetchData,
  throttleKeyTradeFee,
} from "../Utilities/DataFetchThrottle";
import { Exchange, isBinance } from "./Exchange";
import type { Balances } from "./Balances";
import { logToFile } from "../Utilities/LogToFile";

const BINANCE_STANDARD_FEE_PCT = 0.1;
const BINANCE_BNB_DISCOUNT_FEE_PCT = 0.075;

const feePctBySymbol = new Map<string, { pct: number; at: number }>();

const isBinanceTimestampAheadError = (error: unknown): boolean => {
  const e = error as { code?: number; body?: string; msg?: string };
  if (Number(e?.code) === -1021) return true;
  const msg = String(e?.body ?? e?.msg ?? error ?? "");
  return msg.includes("Timestamp for this request");
};

const syncBinanceServerTime = async (exchange: Exchange): Promise<void> => {
  if (!isBinance(exchange)) return;
  try {
    const binanceAny = exchange as { useServerTime?: () => Promise<void> };
    if (typeof binanceAny.useServerTime === "function") {
      await binanceAny.useServerTime();
    }
  } catch (err) {
    logToFile("./logs/error.log", `syncBinanceServerTime(tradeFee): ${String(err)}`);
  }
};

/** Binance SAPI tradeFee → prosenttipisteet per kauppa (esim. 0.075 = 0,075 %). */
export const parseBinanceTakerCommissionPct = (raw: unknown): number | undefined => {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (row == null || typeof row !== "object") return undefined;
  const taker = parseFloat(String((row as { takerCommission?: string }).takerCommission ?? ""));
  if (!Number.isFinite(taker) || taker < 0) return undefined;
  return taker * 100;
};

export const inferBinanceTradeFeePctFromBnbBalance = (balances: Balances): number => {
  const bnb = balances.BNB?.crypto ?? 0;
  return bnb > 0 ? BINANCE_BNB_DISCOUNT_FEE_PCT : BINANCE_STANDARD_FEE_PCT;
};

export const fetchBinanceTakerFeePct = async (
  exchange: Exchange,
  symbolName: string
): Promise<number | undefined> => {
  if (!isBinance(exchange)) return undefined;
  const apiSymbol = toSymbolKey(symbolName);
  const cached = feePctBySymbol.get(apiSymbol);
  if (cached && Date.now() - cached.at < 30_000) return cached.pct;

  const callTradeFee = async (): Promise<unknown> => {
    const binance = exchange as {
      tradeFee?: (callback: unknown, symbol?: string | false) => Promise<unknown>;
    };
    if (typeof binance.tradeFee !== "function") return undefined;
    // node-binance-api: tradeFee(callback, symbol) — älä anna symbolia ensimmäisenä (cb is not a function).
    return binance.tradeFee(undefined, apiSymbol);
  };

  try {
    let raw = await callTradeFee();
    const pct = parseBinanceTakerCommissionPct(raw);
    if (pct !== undefined) {
      feePctBySymbol.set(apiSymbol, { pct, at: Date.now() });
      return pct;
    }
  } catch (error) {
    if (isBinanceTimestampAheadError(error)) {
      await syncBinanceServerTime(exchange);
      try {
        const raw = await callTradeFee();
        const pct = parseBinanceTakerCommissionPct(raw);
        if (pct !== undefined) {
          feePctBySymbol.set(apiSymbol, { pct, at: Date.now() });
          return pct;
        }
      } catch (retryErr) {
        logToFile("./logs/error.log", `fetchBinanceTakerFeePct retry: ${String(retryErr)}`);
      }
    } else {
      logToFile("./logs/error.log", `fetchBinanceTakerFeePct: ${String(error)}`);
    }
  }
  return undefined;
};

export const resolveBinanceTradeFeePct = async (
  exchange: Exchange,
  balances: Balances,
  symbolName: string
): Promise<number> => {
  const fromApi = await fetchBinanceTakerFeePct(exchange, symbolName);
  if (fromApi !== undefined) return fromApi;
  return inferBinanceTradeFeePctFromBnbBalance(balances);
};

/** Live Binance: päivitä symbolien tradeFeePercentage ellei käyttäjä lukinnut (tradeFeePercentageAuto === false). */
export const shouldAutoResolveTradeFeePercentage = (
  symbolOptions: SymbolOptions,
  exchangeName?: string
): boolean => {
  if (process.env.SIMULATE === "true") return false;
  if (exchangeName !== "binance") return false;
  if (symbolOptions.tradeFeePercentageAuto === false) return false;
  return true;
};

export const syncBinanceTradeFeesFromAccount = async (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions,
  balances?: Balances
): Promise<void> => {
  if (!isBinance(exchange) || exchangeOptions.name !== "binance") return;
  const bal = balances ?? exchangeOptions.balances;
  if (!bal) return;
  if (!shouldFetchData(throttleKeyTradeFee(exchangeOptions.name))) return;

  const symbols = (exchangeOptions.symbols ?? []).filter((s) => s && s.enabled !== false);
  const autoSymbols = symbols.filter((s) => shouldAutoResolveTradeFeePercentage(s, exchangeOptions.name));
  if (autoSymbols.length === 0) return;

  const refSymbol = autoSymbols[0]?.name;
  if (!refSymbol) return;

  const pct = await resolveBinanceTradeFeePct(exchange, bal, refSymbol);
  for (const sym of autoSymbols) {
    sym.tradeFeePercentage = pct;
  }
  markDataFetched(throttleKeyTradeFee(exchangeOptions.name));
};
