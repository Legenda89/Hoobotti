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
import { calculateSMA } from "./SMA";

export const calculateROC = (candles: Candlestick[], period: number, source: string = "close"): Candlestick[] => {
  const data = candles.map((candle) => candle[source] as number);
  return data
    .map((value, index, arr) => {
      if (index < period) return 0; // Not enough data to calculate ROC
      const prevValue = arr[index - period];
      return ((value - prevValue) / prevValue) * 100;
    })
    .slice(period)
    .map((roc) => ({ close: roc } as Candlestick));
};

export const calculateKST = (
  candles: Candlestick[],
  RocLen1: number,
  RocLen2: number,
  RocLen3: number,
  RocLen4: number,
  SmaLen1: number,
  SmaLen2: number,
  SmaLen3: number,
  SmaLen4: number,
  SigLen: number,
  source: string = "close"
): { kst: number[]; signalLine: number[] } => {
  const smaRoc1 = calculateSMA(calculateROC(candles, RocLen1, source), SmaLen1, "close");
  const smaRoc2 = calculateSMA(calculateROC(candles, RocLen2, source), SmaLen2, "close");
  const smaRoc3 = calculateSMA(calculateROC(candles, RocLen3, source), SmaLen3, "close");
  const smaRoc4 = calculateSMA(calculateROC(candles, RocLen4, source), SmaLen4, "close");
  let kst: number[] = [];
  for (let i = 0; i < smaRoc1.length; i++) {
    const kstValue = smaRoc1[i] * 1 + smaRoc2[i] * 2 + smaRoc3[i] * 3 + smaRoc4[i] * 4;
    kst.push(kstValue);
  }
  const signalLine = calculateSMA(
    [{ close: kst[0] } as Candlestick, ...(kst.map((k) => ({ close: k })) as Candlestick[])],
    SigLen,
    "close"
  ).slice(1);
  return { kst, signalLine };
};
