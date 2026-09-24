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
import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { calculateSMA } from "./SMA";

export const calculateATR = (candles: Candlestick[], period: number = 14, source: string = "close"): number[] => {
  if (period == 0) {
    period = 14;
  }
  if (!candles || candles.length < period){
    return []
  }
  const atrValues: number[] = [];
  // Start at period to ensure i - 1 is within bounds
  for (let i = period - 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atrValues.push(trueRange);
  }
  const atrSMA = calculateSMA(
    atrValues.map((atr) => ({ close: atr } as Candlestick)),
    period,
    source
  );
  return atrSMA;
};

export const logATRSignals = (consoleLogger: ConsoleLogger, atr: number[]) => {
  if (!atr?.length) return;
  const currentATR = atr[atr.length - 1];
  const prevATR = atr[atr.length - 2];
  if (currentATR == null || typeof currentATR !== "number") return;
  let signal = "Neutral";
  if (prevATR != null && currentATR > prevATR) {
    signal = `Increasing`;
  } else if (currentATR < prevATR) {
    signal = `Decreasing`;
  } else {
    signal = `Stable`;
  }
  const highVolatilityThreshold = 2.0;
  const lowVolatilityThreshold = 0.5;
  if (currentATR > highVolatilityThreshold) {
    signal = `High Volatility`;
  } else if (currentATR < lowVolatilityThreshold) {
    signal = `Low Volatility`;
  } else {
    signal = `Medium Volatility`;
  }
  consoleLogger.push("ATR", {
    value: currentATR.toFixed(7),
    signal: signal,
  });
};
