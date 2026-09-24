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

import { toSymbolKey } from "../Utilities/Args";
import { Exchange, isBinance } from "./Exchange";

export interface Filter {
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  minQty: number;
  maxQty: number;
  stepSize: number;
  minNotional: number;
  maxNotional: number;
  bidMultiplierUp: number;
  bidMultiplierDown: number;
  askMultiplierUp: number;
  askMultiplierDown: number;
}

export interface Filters {
  [pair: string]: Filter;
}

/** Binance GET /api/v3/exchangeInfo -vastauksen juurimuoto (tarvitaan symbolien suodattimiin). */
export type BinanceExchangeInfoPayload = {
  symbols: Array<{
    symbol: string;
    filters: Array<{ filterType: string; [key: string]: string | number | undefined }>;
  }>;
};

/**
 * Parsii yhden parin Filter-objektin exchangeInfo-vastauksesta (sama logiikka kuin getFilters).
 */
export const getFilterFromBinanceExchangeInfo = (
  exchangeInfo: BinanceExchangeInfoPayload,
  pair: string
): Filter => {
  const symbolInfo = exchangeInfo.symbols.find(
    (symbol: { symbol: string }) => symbol.symbol === toSymbolKey(pair)
  );
  if (!symbolInfo) {
    throw new Error(`Trading pair ${pair} not found in exchange info`);
  }
  const priceFilter = symbolInfo.filters.find(
    (filter: { filterType: string }) => filter.filterType === "PRICE_FILTER"
  );
  const lotSizeFilter = symbolInfo.filters.find(
    (filter: { filterType: string }) => filter.filterType === "LOT_SIZE"
  );
  const notionalFilter =
    symbolInfo.filters.find((filter: { filterType: string }) => filter.filterType === "NOTIONAL") ??
    symbolInfo.filters.find((filter: { filterType: string }) => filter.filterType === "MIN_NOTIONAL");
  const percentPriceFilter =
    symbolInfo.filters.find((filter: { filterType: string }) => filter.filterType === "PERCENT_PRICE_BY_SIDE") ??
    symbolInfo.filters.find((filter: { filterType: string }) => filter.filterType === "PERCENT_PRICE");
  if (!priceFilter || !lotSizeFilter || !notionalFilter || !percentPriceFilter) {
    throw new Error(`Incomplete filters for ${pair} in exchange info`);
  }
  const minNotional = (notionalFilter as { minNotional?: string }).minNotional ?? (notionalFilter as { notional?: string }).notional;
  const maxNotional = (notionalFilter as { maxNotional?: string }).maxNotional ?? "100000000000000";
  return {
    minPrice: parseFloat(String(priceFilter.minPrice)),
    maxPrice: parseFloat(String(priceFilter.maxPrice)),
    tickSize: parseFloat(String(priceFilter.tickSize)),
    minQty: parseFloat(String(lotSizeFilter.minQty)),
    maxQty: parseFloat(String(lotSizeFilter.maxQty)),
    stepSize: parseFloat(String(lotSizeFilter.stepSize)),
    minNotional: parseFloat(String(minNotional ?? "0")),
    maxNotional: parseFloat(String(maxNotional)),
    bidMultiplierUp: parseFloat(String(percentPriceFilter.bidMultiplierUp ?? "1")),
    bidMultiplierDown: parseFloat(String(percentPriceFilter.bidMultiplierDown ?? "1")),
    askMultiplierUp: parseFloat(String(percentPriceFilter.askMultiplierUp ?? "1")),
    askMultiplierDown: parseFloat(String(percentPriceFilter.askMultiplierDown ?? "1")),
  };
};

/**
 * Julkinen exchangeInfo ilman API-avainta; oma HTTP-timeout (oletus 120 s).
 * node-binance-api käyttää recvWindow:ia myös pyynnön timeoutina (max 60 s) → ESOCKETTIMEDOUT hitaalla verkolla.
 */
export const fetchBinanceExchangeInfoPublic = async (timeoutMs = 120000): Promise<BinanceExchangeInfoPayload> => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`exchangeInfo HTTP ${res.status}`);
    }
    return (await res.json()) as BinanceExchangeInfoPayload;
  } finally {
    clearTimeout(id);
  }
};

export const getFilters = async (exchange: Exchange, pair: string): Promise<Filter> => {
  if (isBinance(exchange)) {
    const exchangeInfo = (await exchange.exchangeInfo()) as BinanceExchangeInfoPayload;
    return getFilterFromBinanceExchangeInfo(exchangeInfo, pair);
  }
  return {
    minPrice: 0,
    maxPrice: 100000000000000,
    tickSize: 0.000000000001,
    minQty: 0.000000000001,
    maxQty: 100000000000000,
    stepSize: 0.000000000001,
    minNotional: 0.000000001,
    maxNotional: 100000000000000,
    bidMultiplierUp: 0.000000000001,
    bidMultiplierDown: 0.000000000001,
    askMultiplierUp: 0.000000000001,
    askMultiplierDown: 0.000000000001,
  };
};
