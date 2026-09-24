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

import { Candlestick } from "../Exchanges/Candlesticks";
import { ConfigOptions, SymbolOptions } from "../Utilities/Args";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";

export interface ema {
  short: number[];
  long: number[];
}

export interface Trend {
  short?: number[];
  long?: number[];
}
export const calculateEMA = (candles: Candlestick[], length: number = 7, source: string = "close"): number[] => {
  // Input validation
  if (!candles || candles.length === 0 || length <= 0) {
    return [];
  }

  const emaValues: number[] = [];
  let prices: number[] = [];

  // Map prices based on source
  if (source === "close") {
    prices = candles.map((candle) => candle.close);
  } else if (source === "open") {
    prices = candles.map((candle) => candle.open);
  } else if (source === "high") {
    prices = candles.map((candle) => candle.high);
  } else if (source === "low") {
    prices = candles.map((candle) => candle.low);
  }

  // Validate prices (return [] silently when not enough data — normal at simulation/stream start)
  if (prices.length < length || prices.length === 0) {
    return [];
  }
  if (prices.some((price) => price == null || isNaN(price))) {
    console.log("Found NaN or null in prices.");
    return [];
  }

  // Calculate initial EMA (simple moving average for the first 'length' periods)
  let sum = 0.0;
  for (let i = 0; i < length; i++) {
    sum += prices[i];
  }
  const initialEMA = sum / length;
  if (isNaN(initialEMA)) {
    console.log("Initial EMA is NaN. %d / %d, prices length: %d", sum, length, prices.length);
    return [];
  }
  emaValues.push(initialEMA);

  // Calculate subsequent EMA values
  const smoothingFactor = 2 / (length + 1);
  for (let i = length; i < prices.length; i++) {
    const currentEMA =
      (prices[i] - emaValues[emaValues.length - 1]) * smoothingFactor + emaValues[emaValues.length - 1];
    if (isNaN(currentEMA)) {
      console.log(`NaN detected at index ${i}, price: ${prices[i]}, prevEMA: ${emaValues[emaValues.length - 1]}`);
      return emaValues; // Stop and return what we have
    }
    emaValues.push(currentEMA);
  }

  return emaValues;
};

export const logEMASignals = (consoleLogger: ConsoleLogger, ema: ema) => {
  if (ema !== undefined) {
    const currentShortEma = ema.short[ema.short.length - 1];
    const currentLongEma = ema.long[ema.long.length - 1];
    const prevShortEma = ema.short[ema.short.length - 2];
    const prevLongEma = ema.long[ema.long.length - 2];
    const emaDiff = currentShortEma - currentLongEma;
    let signal = "";
    if (emaDiff > 0) {
      signal = `Bullish`;
    } else if (emaDiff < 0) {
      signal = `Bearish`;
    } else {
      signal = `Neutral`;
    }
    if (prevShortEma !== undefined && prevLongEma !== undefined) {
      const isBullishCrossover = ema.short > ema.long && prevShortEma <= prevLongEma;
      const isBearishCrossover = ema.short < ema.long && prevShortEma >= prevLongEma;
      const isUpwardDirection = currentShortEma > prevShortEma && currentLongEma > prevLongEma;
      const isDownwardDirection = currentShortEma < prevShortEma && currentLongEma < prevLongEma;
      const isFlatDirection = !isUpwardDirection && !isDownwardDirection;
      if (isBullishCrossover) {
        signal = `Bullish Crossover`;
      } else if (isBearishCrossover) {
        signal = `Bearish Crossover`;
      }
      if (isUpwardDirection) {
        signal = `Upward`;
      } else if (isDownwardDirection) {
        signal = `Downward`;
      } else if (isFlatDirection) {
        signal = `Flat`;
      }
    }
    consoleLogger.push("EMA", {
      short: currentShortEma.toFixed(7),
      long: currentLongEma.toFixed(7),
      diff: (currentShortEma - currentLongEma).toFixed(7),
      signal: signal,
    });
  }
};

export const checkEMASignals = (ema: ema | undefined, symbolOptions: SymbolOptions) => {
  let check = "SKIP";
  if (symbolOptions.indicators !== undefined) {
    if (symbolOptions.indicators.ema && symbolOptions.indicators.ema.enabled) {
      if (!ema?.short?.length || !ema?.long?.length || ema.short.length < 2 || ema.long.length < 2) {
        return "HOLD";
      }
      const currentShortEma = ema.short[ema.short.length - 1];
      const currentLongEma = ema.long[ema.long.length - 1];
      const prevShortEma = ema.short[ema.short.length - 2];
      const prevLongEma = ema.long[ema.long.length - 2];
      const isBullish = currentShortEma > currentLongEma;
      const isBearish = currentShortEma < currentLongEma;
      const isBullishCrossover = currentShortEma > currentLongEma && prevShortEma <= prevLongEma;
      const isBearishCrossover = currentShortEma < currentLongEma && prevShortEma >= prevLongEma;
      const isShortUpwardDirection = currentShortEma > prevShortEma;
      const isShortDownwardDirection = currentShortEma < prevShortEma;
      const isLongUpwardDirection = currentLongEma > prevLongEma;
      const isLongDownwardDirection = currentLongEma < prevLongEma;
      const isUpwardDirection = isShortUpwardDirection && isLongUpwardDirection;
      const isDownwardDirection = isShortDownwardDirection && isLongDownwardDirection;
      if (isBullishCrossover || (isUpwardDirection && isBullish)) {
        symbolOptions.indicators.ema.weight = 1.1;
        return "BUY";
      }
      if (isBearishCrossover || (isDownwardDirection && isBearish)) {
        symbolOptions.indicators.ema.weight = 1.1;
        return "SELL";
      }
      symbolOptions.indicators.ema.weight = 1;
      return "HOLD";
    }
  }
  return check;
};

export const checkTrendSignal = (ema: Trend) => {
  let trend = "LONG";
  if (
    ema.long !== undefined &&
    ema.short !== undefined &&
    ema.short.length >= 2 &&
    ema.long.length >= 2
  ) {
    const currentShortEma = ema.short[ema.short.length - 1];
    const currentLongEma = ema.long[ema.long.length - 1];
    const prevShortEma = ema.short[ema.short.length - 2];
    const prevLongEma = ema.long[ema.long.length - 2];
    const isBullish = currentShortEma > currentLongEma;
    const isBearish = currentShortEma < currentLongEma;
    const isShortUpwardDirection = currentShortEma > prevShortEma;
    const isShortDownwardDirection = currentShortEma < prevShortEma;
    const isLongUpwardDirection = currentLongEma > prevLongEma;
    const isLongDownwardDirection = currentLongEma < prevLongEma;
    const isUpwardDirection = isShortUpwardDirection && isLongUpwardDirection;
    const isDownwardDirection = isShortDownwardDirection && isLongDownwardDirection;
    const diff = currentShortEma - currentLongEma;
    if (isUpwardDirection && isBullish) {
      trend = "LONG";
    } else if (isDownwardDirection && isBearish) {
      trend = "SHORT";
    }
  }
  return trend;
};
