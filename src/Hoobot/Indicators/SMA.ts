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
import { Indicators } from "../Modes/Algorithmic";
import { ConfigOptions, SymbolOptions } from "../Utilities/Args";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";

export interface sma {
  short: number[];
  long: number[];
}

export const calculateSMA = (candles: Candlestick[], period: number = 9, source: string = "close"): number[] => {
  if (candles?.length == 0) {
    return [];
  }
  if (period == 0) {
    period = 9;
  }
  const smaValues: number[] = [];
  let sum = 0;
  for (let i = 0; i < candles?.length; i++) {
    sum += candles[i][source] as number;
    if (i >= period - 1) {
      const sma = sum / period;
      smaValues.push(sma);
      sum -= candles[i - (period - 1)][source] as number;
    }
  }
  // console.log("SMA Values:", JSON.stringify(smaValues));
  return smaValues;
};

export const logSMASignals = (consoleLogger: ConsoleLogger, sma: number[]) => {
  if (!sma?.length || sma.length < 2) return;
  const currentSMA = sma[sma.length - 1];
  const prevSMA = sma[sma.length - 2];
  if (currentSMA == null || typeof currentSMA !== "number") return;
  consoleLogger.push(`SMA Value`, currentSMA.toFixed(7));
  let signal = "Neutral";
  if (currentSMA > prevSMA) {
    signal = `Bullish`;
  } else if (currentSMA < prevSMA) {
    signal = `Bearish`;
  } else {
    signal = `Neutral`;
  }
  const isBullishCrossover = currentSMA > prevSMA;
  const isBearishCrossover = currentSMA < prevSMA;
  if (isBullishCrossover) {
    signal = `Bullish Crossover`;
  } else if (isBearishCrossover) {
    signal = `Bearish Crossover`;
  }
  consoleLogger.push("SMA", {
    value: currentSMA.toFixed(7),
    signal: signal,
  });
};

export const checkSMASignals = (sma: number[] | undefined, symbolOptions: SymbolOptions) => {
  let check = "SKIP";
  if (symbolOptions.indicators !== undefined) {
    if (symbolOptions.indicators.sma && symbolOptions.indicators.sma.enabled) {
      if (!sma?.length || sma.length < 2) {
        return "HOLD";
      }
      check = "HOLD";
      const currentSMA = sma[sma.length - 1];
      const prevSMA = sma[sma.length - 2];
      const isBullishCrossover = currentSMA > prevSMA;
      const isBearishCrossover = currentSMA < prevSMA;
      const isFlatDirection = currentSMA == prevSMA;
      if (isBullishCrossover) {
        check = "BUY";
      } else if (isBearishCrossover) {
        check = "SELL";
      } else if (isFlatDirection) {
        check = "HOLD";
      }
    }
  }
  return check;
};
