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

import fs from "fs";
import { toSymbolKey, type ExchangeOptions } from "../Utilities/Args";
import { Exchange, isBinance, isNonKYC } from "./Exchange";
import { logToFile } from "../Utilities/LogToFile";
import { syncBinanceTradeFeesFromAccount } from "./binanceTradeFee";

export interface DatedBalances {
  [date: string]: Balances;
}

export interface Balance {
  /**
   * Kokonaissaldo (available + onOrder). Käytä MTM/dashboard-näyttöön.
   * Kaupankäyntiin käytä `tradableBalance()` / `available`.
   */
  crypto: number;
  /** Vapaa saldo — ainoa määrä jolla voi asettaa uuden toimeksiannon. */
  available?: number;
  /** Lukittu avoimiin toimeksiantoihin. */
  onOrder?: number;
  usdt: number;
}

export interface Balances {
  [asset: string]: Balance;
}

/** Kaupankäyntiin: vapaa saldo (fallback: crypto yhteensopivuuteen). */
export const tradableBalance = (balance: Balance | undefined | null): number => {
  if (!balance) return 0;
  const free = balance.available;
  if (typeof free === "number" && Number.isFinite(free) && free >= 0) return free;
  const total = balance.crypto;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
};

const isBinanceTimestampAheadError = (error: any): boolean => {
  if (Number(error?.code) === -1021) return true;
  const msg = String(error?.body ?? error?.msg ?? error ?? "");
  return msg.includes("Timestamp for this request");
};

const syncBinanceServerTime = async (exchange: Exchange): Promise<void> => {
  if (!isBinance(exchange)) return;
  try {
    const binanceAny = exchange as any;
    if (typeof binanceAny.useServerTime === "function") {
      await binanceAny.useServerTime();
    }
  } catch (err) {
    logToFile("./logs/error.log", `syncBinanceServerTime(balance): ${String(err)}`);
  }
};

export const getCurrentBalances = async (exchange: Exchange): Promise<Balances> => {
  const fiat = "USDT";
  const currentBalances: Balances = {
    USDT: {
      crypto: 0,
      available: 0,
      onOrder: 0,
      usdt: 0,
    },
  };
  if (isBinance(exchange)) {
    let balances: any;
    let prices: any;
    try {
      balances = await exchange.balance();
      prices = await exchange.prices();
    } catch (error) {
      if (isBinanceTimestampAheadError(error)) {
        await syncBinanceServerTime(exchange);
        balances = await exchange.balance();
        prices = await exchange.prices();
      } else {
        throw error;
      }
    }
    const assets = Object.keys(balances);
    const symbols = Object.keys(prices);
    for (let i = 0; i < assets.length; i++) {
      const { available, onOrder } = balances[assets[i]];
      const free = parseFloat(available) || 0;
      const locked = parseFloat(onOrder) || 0;
      const amount = free + locked;
      if (amount === 0) {
        currentBalances[assets[i]] = {
          crypto: 0,
          available: 0,
          onOrder: 0,
          usdt: 0,
        };
        continue;
      }
      if (assets[i] === "USDT") {
        currentBalances[assets[i]] = {
          crypto: amount,
          available: free,
          onOrder: locked,
          usdt: amount,
        };
      } else {
        let fiatAmount = 0;
        if (symbols.includes(assets[i] + fiat)) {
          fiatAmount = prices[assets[i] + fiat] * amount;
        } else if (symbols.includes(fiat + assets[i])) {
          fiatAmount = amount / prices[fiat + assets[i]];
        } else {
          let tempAmount = amount / prices["BTC" + assets[i]];
          fiatAmount = prices[assets[i] + fiat] * tempAmount;
        }
        currentBalances[assets[i]] = {
          crypto: amount,
          available: free,
          onOrder: locked,
          usdt: Number.isNaN(fiatAmount) ? 0 : fiatAmount,
        };
      }
    }
  } else if (isNonKYC(exchange)) {
    const balances = await exchange.getTradingBalance();
    const prices = await exchange.getMarkets();
    const symbols = prices.map((price) => toSymbolKey(price.symbol));
    if (balances.length > 0) {
      for (const balance of balances) {
        const amount = parseFloat(balance.available) || 0;
        if (balance.asset === "USDT") {
          currentBalances[balance.asset] = {
            crypto: amount,
            available: amount,
            onOrder: 0,
            usdt: amount,
          };
        } else {
          let fiatAmount = 0;
          const price = prices.find((p) => toSymbolKey(p.symbol) === balance.asset + fiat);
          if (symbols.includes(balance.asset + fiat)) {
            fiatAmount = parseFloat(price?.lastPrice!) * amount;
          } else if (symbols.includes(fiat + balance.asset)) {
            fiatAmount = amount / parseFloat(price?.lastPrice!);
          } else {
            const tempPrice = prices.find((p) => toSymbolKey(p.symbol) === "BTC" + balance.asset);
            let tempAmount = amount / parseFloat(tempPrice?.lastPrice!);
            fiatAmount = parseFloat(price?.lastPrice!) * tempAmount;
          }
          currentBalances[balance.asset] = {
            crypto: amount,
            available: amount,
            onOrder: 0,
            usdt: fiatAmount > 0 ? fiatAmount : 0,
          };
        }
      }
    } else {
      // Possibly build empty currentBalances.
    }
  }
  const balanceAssets = Object.keys(currentBalances);
  for (const balanceAsset of balanceAssets) {
    if (currentBalances[balanceAsset].crypto === undefined) {
      currentBalances[balanceAsset].crypto = 0;
    }
    if (currentBalances[balanceAsset].available === undefined) {
      currentBalances[balanceAsset].available = currentBalances[balanceAsset].crypto;
    }
    if (currentBalances[balanceAsset].onOrder === undefined) {
      currentBalances[balanceAsset].onOrder = 0;
    }
    if (currentBalances[balanceAsset].usdt === undefined) {
      currentBalances[balanceAsset].usdt = 0;
    }
  }
  return Object.fromEntries(Object.entries(currentBalances).sort((a, b) => b[1].usdt - a[1].usdt));
};

/** Hae saldot ja päivitä Binance trade fee -% muistissa (live). */
export const assignCurrentBalances = async (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions
): Promise<Balances> => {
  const balances = await getCurrentBalances(exchange);
  exchangeOptions.balances = balances;
  await syncBinanceTradeFeesFromAccount(exchange, exchangeOptions, balances);
  return balances;
};

export const getCurrentBalance = async (exchange: Exchange, asset: string): Promise<Balance> => {
  const balances = await getCurrentBalances(exchange);
  return balances[asset];
};

/** node-binance-api lokee `balanceData error` kun WS-account payloadissa ei ole balances[] — tehdään REST-korjaus (throttle). */
const BINANCE_BALANCE_DATA_ERROR_REFRESH_MS = 30_000;

/**
 * Palauttaa `options.log`-funktion Binance-instanssille: sama tuloste kuin kirjaston oletus + REST-saldopäivitys kun ilmoitus osuu.
 */
export const createBinanceBalanceDataErrorLogBridge = (
  exchange: Exchange,
  exchangeOptions: ExchangeOptions
): ((...args: unknown[]) => void) => {
  let lastRestRefreshAt = 0;
  return (...args: unknown[]): void => {
    console.log(Array.prototype.slice.call(args));
    if (args[0] !== "balanceData error") return;
    if (!isBinance(exchange)) return;
    const now = Date.now();
    if (now - lastRestRefreshAt < BINANCE_BALANCE_DATA_ERROR_REFRESH_MS) return;
    lastRestRefreshAt = now;
    void (async () => {
      try {
        exchangeOptions.balances = await getCurrentBalances(exchange);
        await syncBinanceTradeFeesFromAccount(exchange, exchangeOptions, exchangeOptions.balances);
        console.log("[Binance] Saldot päivitetty REST-pyynnöllä (balanceData error / user data stream).");
      } catch (err) {
        console.warn("[Binance] Saldopäivitys balanceData-virheen jälkeen epäonnistui:", err);
        logToFile("./logs/error.log", `balanceData error → REST refresh failed: ${String(err)}\n`);
      }
    })();
  };
};

export const storeBalances = async (exchange: Exchange, balances: Balances) => {
  const currentDate = new Date().toLocaleString();
  let ex = "binance";
  if (isNonKYC(exchange)) {
    ex = "nonkyc";
  }
  const logsDir = "./logs";
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  const filePath = `./logs/balances-${ex}.json`;
  let balancesInFile: DatedBalances[] = [];
  if (fs.existsSync(filePath)) {
    try {
      const fileContent = fs.readFileSync(filePath, "utf8");
      if (fileContent != undefined && fileContent !== "") {
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed)) balancesInFile = parsed;
      }
    } catch {
      // corrupted file: leave balancesInFile empty, will write fresh
    }
  } else {
    fs.writeFileSync(filePath, JSON.stringify([], null, 4));
  }
  if (balancesInFile.length == 0) {
    balancesInFile.push({ [currentDate]: balances });
    fs.writeFileSync(filePath, JSON.stringify(balancesInFile, null, 4));
  }
};
