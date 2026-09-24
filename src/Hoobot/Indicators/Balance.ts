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

import { ConsoleLogger } from "../Utilities/ConsoleLogger";
import { ExchangeOptions } from "../Utilities/Args";
import { Filter } from "../Exchanges/Filters";
import { checkPreviousTrade } from "../Exchanges/Trades";
import { tradableBalance } from "../Exchanges/Balances";

export const checkBalanceSignals = (
  consoleLogger: ConsoleLogger,
  symbol: string,
  closePrice: number,
  exchangeOptions: ExchangeOptions,
  filter: Filter
) => {
  let check = "HOLD";
  if (exchangeOptions.balances !== undefined) {
    if (exchangeOptions.balances[symbol.split("/")[0]] == undefined) {
      exchangeOptions.balances[symbol.split("/")[0]] = {
        crypto: 0,
        available: 0,
        onOrder: 0,
        usdt: 0,
      };
    }
    if (exchangeOptions.balances[symbol.split("/")[1]] == undefined) {
      exchangeOptions.balances[symbol.split("/")[1]] = {
        crypto: 0,
        available: 0,
        onOrder: 0,
        usdt: 0,
      };
    }
    const baseBalance = tradableBalance(exchangeOptions.balances[symbol.split("/")[0]]);
    const quoteBalance = tradableBalance(exchangeOptions.balances[symbol.split("/")[1]]);
    const baseBalanceConverted = baseBalance * closePrice;
    const minNotional = filter?.minNotional ?? 0;
    const maxNotional = filter?.maxNotional ?? Number.POSITIVE_INFINITY;
    let tradeCheck = checkPreviousTrade(symbol, exchangeOptions);
    if (tradeCheck === "SELL") {
      if (quoteBalance > minNotional) {
        check = "BUY";
      } else {
        if (baseBalanceConverted >= minNotional) {
          check = "SELL";
        } else {
          check = "HOLD";
        }
      }
    } else if (tradeCheck === "BUY") {
      if (baseBalanceConverted > minNotional) {
        check = "SELL";
      } else {
        if (quoteBalance >= minNotional) {
          check = "BUY";
        } else {
          check = "HOLD";
        }
      }
    }
    // SELL (= sulku long): vain minNotional. maxNotional ei saa estää sulkua.
    if (check === "SELL" && baseBalanceConverted < minNotional) {
      check = "HOLD";
    } else if (check === "BUY" && (quoteBalance < minNotional || quoteBalance > maxNotional)) {
      check = "HOLD";
    }
    consoleLogger.push("Trades", {
      previous: tradeCheck,
      next: check,
      baseAvailable: baseBalance,
      quoteAvailable: quoteBalance,
    });
  }

  return check;
};
