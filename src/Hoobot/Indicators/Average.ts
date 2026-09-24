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

export const calculateAverage = (candlesticks: Candlestick[]): number => {
  if (candlesticks === undefined || candlesticks.length === 0) {
    return 0;
  }
  candlesticks = candlesticks.slice(-150);
  let totalPrice = 0;
  for (let i = 0; i < candlesticks.length; i++) {
    totalPrice += (candlesticks[i].close + candlesticks[i].high + candlesticks[i].low + candlesticks[i].open) / 4;
  }
  return totalPrice / candlesticks.length;
};

export const logAverageSignals = (consoleLogger: ConsoleLogger, candlesticks: Candlestick[], average: number) => {
  let signal = "Neutral";
  if (candlesticks[candlesticks.length - 1].high < average) {
    signal = "Buy";
  } else if (candlesticks[candlesticks.length - 1].low > average) {
    signal = "Sell";
  }
  consoleLogger.push("Average", {
    value: average,
    signal: signal,
  });
};
