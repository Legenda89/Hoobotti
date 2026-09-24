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
import { SymbolOptions } from "../Utilities/Args";
import { ConsoleLogger } from "../Utilities/ConsoleLogger";

export interface DMI {
  plusDI: number[];
  minusDI: number[];
  adx: number[];
}

export const calculateDMI = (
  candles: Candlestick[], 
  dmiLength: number = 14,     // Length for calculating +DI and -DI
  adxSmoothing: number = 14  // Period for smoothing the ADX
): DMI => {
  if (!Array.isArray(candles) || candles?.length <= 0) {
    return {
      plusDI: [],
      minusDI: [],
      adx: []
    }
  }
  let plusDM: number[] = [];
  let minusDM: number[] = [];
  let tr: number[] = [];
  let plusDI: number[] = [];
  let minusDI: number[] = [];
  let adx: number[] = [];

  // Calculate True Range (TR) and Directional Movements (DM)
  for (let i = 1; i < candles.length; i++) {
    const prevCandle = candles[i - 1];
    const currCandle = candles[i];

    const highDiff = currCandle.high - prevCandle.high;
    const lowDiff = prevCandle.low - currCandle.low;

    // True Range
    const trValue = Math.max(
      currCandle.high - currCandle.low,
      Math.abs(currCandle.high - prevCandle.close),
      Math.abs(currCandle.low - prevCandle.close)
    );
    tr.push(trValue);

    // Directional Movements
    let plusDMValue = 0;
    let minusDMValue = 0;

    if (highDiff > lowDiff && highDiff > 0) {
      plusDMValue = highDiff;
    }
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDMValue = lowDiff;
    }

    plusDM.push(plusDMValue);
    minusDM.push(minusDMValue);
  }

  // Smooth the values using a simple moving average
  for (let i = dmiLength - 1; i < candles.length; i++) {
    const sumTR = tr.slice(i - dmiLength + 1, i + 1).reduce((acc, val) => acc + val, 0);
    const sumPlusDM = plusDM.slice(i - dmiLength + 1, i + 1).reduce((acc, val) => acc + val, 0);
    const sumMinusDM = minusDM.slice(i - dmiLength + 1, i + 1).reduce((acc, val) => acc + val, 0);

    // Smoothed TR, +DM, and -DM
    const smoothedTR = sumTR;
    const smoothedPlusDM = sumPlusDM;
    const smoothedMinusDM = sumMinusDM;

    // +DI and -DI
    plusDI.push((smoothedPlusDM / smoothedTR) * 100);
    minusDI.push((smoothedMinusDM / smoothedTR) * 100);
  }

  // Calculate ADX (Average Directional Index)
  for (let i = dmiLength; i < plusDI.length; i++) {
    const dx = Math.abs(plusDI[i] - minusDI[i]) / (plusDI[i] + minusDI[i]) * 100;
    adx.push(dx);
  }

  // Smooth the ADX over the ADX smoothing period
  for (let i = adxSmoothing; i < adx.length; i++) {
    const smoothedADX = adx.slice(i - adxSmoothing + 1, i + 1).reduce((acc, val) => acc + val, 0) / adxSmoothing;
    adx[i] = smoothedADX;
  }

  return {
    plusDI,
    minusDI,
    adx,
  };
};

export const logDMISignals = (
  consoleLogger: ConsoleLogger,
  dmi: DMI
) => {
  if (!dmi?.plusDI?.length || !dmi?.minusDI?.length || !dmi?.adx?.length) return;
  const lastPlusDI = dmi.plusDI[dmi.plusDI.length - 1];
  const lastMinusDI = dmi.minusDI[dmi.minusDI.length - 1];
  const lastADX = dmi.adx[dmi.adx.length - 1];
  if (lastPlusDI == null || lastMinusDI == null || lastADX == null) return;

  let signal = 'Neutral';
  if (lastPlusDI > lastMinusDI) {
    signal = 'Bullish';
  } else if (lastMinusDI > lastPlusDI) {
    signal = 'Bearish';
  }

  consoleLogger.push("DMI", {
    plusDI: lastPlusDI,
    minusDI: lastMinusDI,
    adx: lastADX,
    signal: signal,
  });
};

export const checkDMISignals = (
  dmi: DMI,
  symbolOptions: SymbolOptions
): string => {
  let check = 'SKIP';
  if (symbolOptions.indicators !== undefined) {
    if (symbolOptions.indicators.dmi && symbolOptions.indicators.dmi.enabled) {
      if (!dmi?.plusDI?.length || !dmi?.minusDI?.length || !dmi?.adx?.length) {
        return "HOLD";
      }
      const lastPlusDI = dmi.plusDI[dmi.plusDI.length - 1];
      const lastMinusDI = dmi.minusDI[dmi.minusDI.length - 1];
      const lastADX = dmi.adx[dmi.adx.length - 1];
      if (lastADX < 20) {
        return "HOLD";
      }
      if (lastPlusDI > lastMinusDI) {
        check = "BUY";
      } else if (lastMinusDI > lastPlusDI) {
        check = "SELL";
      } else {
        check = "HOLD";
      }
    }
  }
  return check;
};
