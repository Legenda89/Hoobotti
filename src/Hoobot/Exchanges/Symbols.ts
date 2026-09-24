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
import { Exchange, isBinance } from "./Exchange";
import { logToFile } from "../Utilities/LogToFile";

export interface SymbolInfo {
  symbol: string;
  base: string;
  quote: string;
}

// Function to get all symbols from Binance
export const getTradeableSymbols = async (exchange: Exchange, quote: string): Promise<SymbolInfo[]> => {
  let symbolInfos: SymbolInfo[] = [];
  if (isBinance(exchange)) {
    if (!exchange || typeof exchange.exchangeInfo !== "function") {
      throw new Error("Invalid 'exchange' object or missing 'exchangeInfo' function.");
    }

    const exchangeInfo = await exchange.exchangeInfo();

    symbolInfos = exchangeInfo.symbols
      .filter((symbol: any) => symbol.quoteAsset === quote)
      .filter((symbol: any) => symbol.status === "TRADING")
      .filter((symbol: any) => symbol.isSpotTradingAllowed)
      .map((symbol: any) => {
        return { symbol: symbol.symbol, base: symbol.baseAsset, quote: symbol.quoteAsset };
      });
  }
  return symbolInfos;
};
