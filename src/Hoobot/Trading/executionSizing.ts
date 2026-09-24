/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import { Filter } from "../Exchanges/Filters";
import { SymbolOptions } from "../Utilities/Args";
import { simFeeRatePerLeg } from "./tradeGates";

export const SIM_SELL_BID_FACTOR = 0.999;
export const SIM_BUY_ASK_FACTOR = 1.001;

export const LIVE_BASE_RESERVE = 0.98;
export const LIVE_ASK_DISCOUNT = 0.999;
export const LIVE_BID_PREMIUM = 1.001;
export const MIN_QUOTE_NOTIONAL = 1.1;

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const tickSizePrecision = Math.floor(Math.log10(Math.abs(step))) * -1;
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(Math.max(0, tickSizePrecision)));
}

/** Pyöristä alaspäin stepSizeen — ei ylitä vapaata saldoa. */
export function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const tickSizePrecision = Math.floor(Math.log10(Math.abs(step))) * -1;
  const floored = Math.floor(value / step + 1e-12) * step;
  return Number(floored.toFixed(Math.max(0, tickSizePrecision)));
}

export function capSellBaseByGrowingMax(baseQuantity: number, symbolOptions: SymbolOptions): number {
  const cap = symbolOptions.growingMax?.sell;
  if (cap !== undefined && cap > 0) return Math.min(baseQuantity, cap);
  return baseQuantity;
}

export function capBuyQuoteByGrowingMax(
  quoteQuantity: number,
  symbolOptions: SymbolOptions,
  applyGrowingMaxCap: boolean = true
): number {
  if (!applyGrowingMaxCap) return quoteQuantity;
  const cap = symbolOptions.growingMax?.buy;
  if (cap !== undefined && cap > 0) return Math.min(quoteQuantity, cap);
  return quoteQuantity;
}

export type LiveSellExecution = {
  askPrice: number;
  askPriceDiscounted: number;
  quantityInBase: number;
  roundedPrice: number;
  roundedQuantityInBase: number;
  roundedQuantityInQuote: number;
};

export function computeLiveSellExecution(opts: {
  baseBalance: number;
  orderBookAsks: Record<string, number>;
  filter: Filter;
  symbolOptions: SymbolOptions;
  forceQuantityInBase?: number;
}): LiveSellExecution | null {
  const askPrices = Object.keys(opts.orderBookAsks)
    .map((p) => parseFloat(p))
    .sort((a, b) => a - b);
  const askPrice = askPrices[0];
  if (!askPrice || !Number.isFinite(askPrice)) return null;

  const askPriceDiscounted = askPrice * LIVE_ASK_DISCOUNT;
  // Älä rajaa kokoa orderbookin ylimmän tason määrään — limit-tilaus voi olla suurempi.
  let quantityInBase = opts.baseBalance * LIVE_BASE_RESERVE;
  quantityInBase = capSellBaseByGrowingMax(quantityInBase, opts.symbolOptions);
  if (opts.forceQuantityInBase !== undefined) {
    quantityInBase = Math.min(opts.forceQuantityInBase, opts.baseBalance * LIVE_BASE_RESERVE);
  }

  const roundedPrice = roundToStep(askPriceDiscounted, opts.filter.tickSize);
  // Floor: Math.round voi nostaa qty:n yli vapaan saldon → Binance -2010.
  const roundedQuantityInBase = floorToStep(quantityInBase, opts.filter.stepSize);
  if (!(roundedPrice > 0) || !(roundedQuantityInBase > 0)) return null;
  const roundedQuantityInQuote = roundedQuantityInBase * roundedPrice;

  return {
    askPrice,
    askPriceDiscounted,
    quantityInBase,
    roundedPrice,
    roundedQuantityInBase,
    roundedQuantityInQuote,
  };
}

export type LiveBuyExecution = {
  bidPrice: number;
  bidPriceIncremented: number;
  /** Kun aggressiveEntry: käytetty ask-puolen hinta. */
  entryPrice?: number;
  aggressiveEntry?: boolean;
  roundedPrice: number;
  roundedQuantityInBase: number;
  roundedQuantityInQuote: number;
};

export function shouldUseAggressiveLiveBuy(profit: string): boolean {
  return profit !== "GRID" && profit !== "TAKE_PROFIT" && profit !== "TAKE_PROFIT_FORCE";
}

export function computeLiveBuyExecution(opts: {
  quoteBalance: number;
  orderBookBids: Record<string, number>;
  orderBookAsks?: Record<string, number>;
  filter: Filter;
  symbolOptions: SymbolOptions;
  forceQuantityInBase?: number;
  aggressiveEntry?: boolean;
}): LiveBuyExecution | null {
  if (opts.aggressiveEntry && opts.orderBookAsks) {
    const askPrices = Object.keys(opts.orderBookAsks)
      .map((p) => parseFloat(p))
      .sort((a, b) => a - b);
    const askPrice = askPrices[0];
    if (askPrice && Number.isFinite(askPrice)) {
      const entryPrice = askPrice * SIM_BUY_ASK_FACTOR;
      let quantityInQuote = capBuyQuoteByGrowingMax(opts.quoteBalance, opts.symbolOptions, true);
      // Älä rajaa quote-kokoa ask-tason BTC-määrään (se on base-qty, ei quote).
      if (opts.forceQuantityInBase !== undefined) {
        quantityInQuote = opts.forceQuantityInBase * entryPrice;
      }
      const roundedPrice = roundToStep(entryPrice, opts.filter.tickSize);
      const quantityInBase = (quantityInQuote / entryPrice) * LIVE_BASE_RESERVE;
      const roundedQuantityInBase = floorToStep(quantityInBase, opts.filter.stepSize);
      if (!(roundedPrice > 0) || !(roundedQuantityInBase > 0)) return null;
      const spentQuote = roundedQuantityInBase * roundedPrice;
      if (spentQuote > quantityInQuote && quantityInQuote > 0) {
        // floor uudelleen jos hinta pyöristyi ylöspäin
        const adjustedBase = floorToStep(quantityInQuote / roundedPrice, opts.filter.stepSize);
        if (!(adjustedBase > 0)) return null;
        return {
          bidPrice: askPrice,
          bidPriceIncremented: entryPrice,
          entryPrice,
          aggressiveEntry: true,
          roundedPrice,
          roundedQuantityInBase: adjustedBase,
          roundedQuantityInQuote: adjustedBase * roundedPrice,
        };
      }
      return {
        bidPrice: askPrice,
        bidPriceIncremented: entryPrice,
        entryPrice,
        aggressiveEntry: true,
        roundedPrice,
        roundedQuantityInBase,
        roundedQuantityInQuote: spentQuote,
      };
    }
  }

  const bidPrices = Object.keys(opts.orderBookBids)
    .map((p) => parseFloat(p))
    .sort((a, b) => b - a);
  const bidPrice = bidPrices[0];
  if (!bidPrice || !Number.isFinite(bidPrice)) return null;

  const bidPriceIncremented = bidPrice * LIVE_BID_PREMIUM;
  // Älä rajaa quote-kokoa bid-tason BTC-määrään (bids[price] = base-qty, ei quote).
  let quantityInQuote = capBuyQuoteByGrowingMax(opts.quoteBalance, opts.symbolOptions, true);
  if (opts.forceQuantityInBase !== undefined) {
    quantityInQuote = opts.forceQuantityInBase * bidPriceIncremented;
  }

  const roundedPrice = roundToStep(bidPriceIncremented, opts.filter.tickSize);
  const quantityInBase = (quantityInQuote / bidPriceIncremented) * LIVE_BASE_RESERVE;
  let roundedQuantityInBase = floorToStep(quantityInBase, opts.filter.stepSize);
  if (!(roundedPrice > 0) || !(roundedQuantityInBase > 0)) return null;
  let roundedQuantityInQuote = roundedQuantityInBase * roundedPrice;
  if (roundedQuantityInQuote > quantityInQuote && quantityInQuote > 0) {
    roundedQuantityInBase = floorToStep(quantityInQuote / roundedPrice, opts.filter.stepSize);
    if (!(roundedQuantityInBase > 0)) return null;
    roundedQuantityInQuote = roundedQuantityInBase * roundedPrice;
  }

  return {
    bidPrice,
    bidPriceIncremented,
    roundedPrice,
    roundedQuantityInBase,
    roundedQuantityInQuote,
  };
}

export function simPriceFromCandle(candle: { close: number }): number {
  return candle.close;
}

/** Sim myynti: bid puolella (kuten live LIVE_ASK_DISCOUNT vastine). */
export function simSellPriceFromCandle(candle: { close: number }): number {
  return candle.close * SIM_SELL_BID_FACTOR;
}

/** Sim osto: ask puolella (kuten live LIVE_BID_PREMIUM vastine). */
export function simBuyPriceFromCandle(candle: { close: number }): number {
  return candle.close * SIM_BUY_ASK_FACTOR;
}

export function simSellBaseQuantity(baseBalance: number): number {
  return baseBalance * LIVE_BASE_RESERVE;
}

export function simFeeOnQuote(notional: number, tradeFeePercentage?: number): number {
  return notional * simFeeRatePerLeg(tradeFeePercentage);
}

export function simFeeOnBase(baseQuantity: number, tradeFeePercentage?: number): number {
  return baseQuantity * simFeeRatePerLeg(tradeFeePercentage);
}
