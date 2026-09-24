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
import * as fs from "fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import {
  applyRecommendedAlgorithmicIndicators,
  shouldApplyComplementaryIndicators,
} from "../Modes/algorithmicIndicators";
import { roundTripFeePct } from "../Modes/algorithmicAdaptive";
import { normalizeScoutConfirmTimeframes } from "../Modes/scoutConfirm";
import { normalizeSimulationSymbolDefaults } from "../Simulation/simModeHelpers";
import { normalizeAlgorithmicIndicatorParams } from "../Indicators/indicatorParams";
import { Balances } from "../Exchanges/Balances";
import { Orderbooks } from "../Exchanges/Orderbook";
import { TradeHistory } from "../Exchanges/Trades";
import { Order } from "../Exchanges/Orders";
import { logToFile } from "./LogToFile";
import { Exchange } from "../Exchanges/Exchange";
import { normalizeLiveOrderExecution, type LiveOrderExecutionConfig } from "../Trading/liveOrderExecution";

export interface CurrentProfitMax {
  [symbol: string]: number;
}

export type CandlestickInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export type BotMode = "algorithmic" | "hilow" | "arbitrage";

/** Normalizes symbol to exchange key format (e.g. "BTC/USDT" -> "BTCUSDT"). */
export const toSymbolKey = (symbol: string): string => symbol.split("/").join("");

export const getSecondsFromInterval = (interval: CandlestickInterval): number => {
  const intervalToSeconds: Record<CandlestickInterval, number> = {
    "1m": 60,
    "3m": 60 * 3,
    "5m": 60 * 5,
    "15m": 60 * 15,
    "30m": 60 * 30,
    "1h": 60 * 60,
    "2h": 60 * 60 * 2,
    "4h": 60 * 60 * 4,
    "6h": 60 * 60 * 6,
    "8h": 60 * 60 * 8,
    "12h": 60 * 60 * 12,
    "1d": 60 * 60 * 24,
    "3d": 60 * 60 * 24 * 3,
    "1w": 60 * 60 * 24 * 7,
    "1M": 60 * 60 * 24 * 30, // Assuming 30 days in a month
  };
  return intervalToSeconds[interval];
};

export const getMinutesFromInterval = (interval: CandlestickInterval): number => {
  const intervalToSeconds: Record<CandlestickInterval, number> = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 60 * 2,
    "4h": 60 * 4,
    "6h": 60 * 6,
    "8h": 60 * 8,
    "12h": 60 * 12,
    "1d": 60 * 24,
    "3d": 60 * 24 * 3,
    "1w": 60 * 24 * 7,
    "1M": 60 * 24 * 30, // Assuming 30 days in a month
  };
  return intervalToSeconds[interval];
};

export interface OpenOrders {
  [symbol: string]: Order[];
}

export interface ExchangeOptions {
  name: string;
  socket: Exchange;
  key: string;
  secret: string;
  mode: "algorithmic" | "hilow" | "extreme" | "grid" | "consecutive" | "periodic";
  forceStopOnDisconnect: boolean;
  console: string;
  openOrders: OpenOrders;
  balances: Balances;
  tradeHistory: TradeHistory;
  orderbooks: Orderbooks;
  symbols: SymbolOptions[];
  /** When true, no real orders are placed (dry run). */
  dryRun?: boolean;
  /**
   * Binance REST: HTTP-pyynnön timeout millisekunteina (node-binance `request`).
   * Ei sama kuin API:n `recvWindow`. Oletus Hoobotissa 300000 (5 min).
   */
  binanceHttpRequestTimeoutMs?: number;
  /**
   * Simulaatio: sessioalku (ms) — agreementEase mittaa odotuksen tästä kun tradeHistory on tyhjä.
   * Liveissä ei aseteta (ease ei käynnisty "ikuisuudesta").
   */
  simulationSessionStartMs?: number;
}

export interface GridLevel {
  orderId: string;
  price: number;
  size: string;
  type: "buy" | "sell";
  executed: boolean;
}

export interface SymbolOptions {
  /** Kun false, paria ei treidata (live tai sim) — oletus true jos puuttuu. */
  enabled?: boolean;
  currentOrder: Order | undefined;
  noPreviousTradeCheck: boolean;
  minimumTimeSinceLastTrade: number;
  name: string;
  timeframes: CandlestickInterval[];
  agreement: number;
  source: "close" | "high" | "low";
  consecutiveQuantity: number;
  consecutiveDirection: "SELL" | "BUY" | undefined;
  consecutivePreviousDirection: string | undefined;
  consecutiveNextTrade: string | undefined;
  consecutiveTradeAllowed: boolean | undefined;
  periodicDirection: "SELL" | "BUY" | undefined;
  periodicQuantity: number;
  periodicInterval: number;
  periodicTime: number;
  trend?: {
    current: string;
    enabled: boolean;
    timeframe: CandlestickInterval;
    ema: {
      short: number;
      long: number;
    };
  };
  profit?: {
    enabled: boolean;
    minimumSell: number;
    minimumBuy: number;
  };
  price?: {
    enabled: boolean;
    maximumSell: number;
    minimumSell: number;
    maximumBuy: number;
    minimumBuy: number;
  };
  growingMax?: {
    buy: number;
    sell: number;
  };
  /** Simulaation kiinteä ostosumma quote-valuutassa. 0/tyhjä = käytä koko käytettävissä olevaa quote-saldoa. */
  simulationBuyAmountQuote?: number;
  /** Live: limit / aggressiveLimit / market per puoli (Binance). */
  liveOrderExecution?: LiveOrderExecutionConfig;
  closePercentage?: number;
  maximumAgeOfOrder?: number;
  tradeFeePercentage?: number;
  /** Live Binance: true/undefined = päivitä tradeFeePercentage tilin BNB-saldon / tradeFee-API:n mukaan. */
  tradeFeePercentageAuto?: boolean;
  stopLoss?: {
    enabled: boolean;
    stopTrading: boolean;
    pnl: number;
    agingPerHour: number;
    hit: boolean;
    atrScale?: boolean;
    atrMultiplier?: number;
    atrMin?: number;
    atrMax?: number;
  };
  stopLossBuy?: {
    enabled: boolean;
    pnl: number;
    agingPerHour: number;
    hit?: boolean;
    atrScale?: boolean;
    atrMultiplier?: number;
    atrMin?: number;
    atrMax?: number;
  };
  takeProfit?: {
    enabled: boolean;
    /** Vähimmäis-unrealized % vain TP-suluissa (trailing). 0 = ei lattiaa. Ei koske stop lossia. */
    limit: number;
    /** Trailing-aktivointi: unrealized ≥ minimum → armed. Ei yksinään sulje. */
    minimum: number;
    /** Sulku kun huipusta pudonnut ≥ drop % (vaatii armed). */
    drop: number;
    current: number;
    /** When to update currentMax: "update" every tick, "trade" only on order, "final" only on candle close. */
    currentMaxSource?: "update" | "trade" | "final";
    /** Pakkosulku huipun jälkeen (H14 forceAfter): pudotus ≥ drop, vähintään minProfit, myös HOLD. */
    forceAfterEnabled?: boolean;
    forceAfterCandles?: number;
    forceAfterDrop?: number;
    forceMinProfit?: number;
    /** Ensimmäinen TAKE_PROFIT sulkee vain osan; loput trailaa. */
    partialClose?: { enabled?: boolean; fraction?: number };
  };
  /** Erillinen TP vain kun enabled === true ja next === BUY; muuten takeProfit. */
  takeProfitBuy?: {
    enabled: boolean;
    /** Kuten takeProfit.limit (vain kun tämä osio käytössä BUY-polulla). */
    limit: number;
    /** Kuten takeProfit.minimum (arming BUY-polulla). */
    minimum: number;
    /** Kuten takeProfit.drop (BUY-sulku). */
    drop: number;
    current: number;
    currentMaxSource?: "update" | "trade" | "final";
    forceAfterEnabled?: boolean;
    forceAfterCandles?: number;
    forceAfterDrop?: number;
    forceMinProfit?: number;
    partialClose?: { enabled?: boolean; fraction?: number };
  };
  forcedExit?: {
    enabled?: boolean;
    candles?: number;
    change?: number;
    /** Minimum unrealized PNL% required for forced exit. Prevents accidental loss trades. */
    minProfit?: number;
    /** Hours in position → flatten even if red (capital efficiency; does not wait for stopLoss). */
    maxHours?: number;
  };
  /** HiLow fixed EUR: myy kun quote-voitto ≥ sellProfitQuote; osta kun hinta on laskenut buyMoveQuote EUR verran. */
  hilowFixed?: {
    sellProfitQuote?: number;
    buyMoveQuote?: number;
    stopLossQuote?: number;
  };
  /**
   * Algorithmic paradigm: meanReversion | momentum | complementary (legacy mix) | custom.
   * Load applies enabled/weight for non-custom presets.
   */
  indicatorsPreset?: "meanReversion" | "meanReversionVolatile" | "momentum" | "complementary" | "custom";
  /** Algorithmic: ATR-skaalaus, trendi-agreement, konflikti, idle-ease (oletus päällä). */
  algorithmicAdaptive?: {
    enabled?: boolean;
    volatilityScale?: boolean;
    atrLookback?: number;
    volatilityAgreement?: boolean;
    trendAgreement?: boolean;
    trendAlignedBonus?: number;
    trendCounterPenalty?: number;
    blockCounterTrendEntries?: boolean;
    conflictEnabled?: boolean;
    conflictMinShare?: number;
    conflictPenalty?: number;
    maxCashCandles?: number;
    maxLongCandles?: number;
    agreementEaseMax?: number;
    feeAwareMinProfit?: boolean;
  };
  /** Algorithmic: scout (1m) + confirm (3m) — entry vain sulkeutuneella scout-kynttilällä. */
  scoutConfirm?: {
    enabled?: boolean;
    scoutTimeframe?: CandlestickInterval;
    confirmTimeframe?: CandlestickInterval;
    scoutMinShare?: number;
    confirmAgreement?: number;
    scoutIndicators?: ("rsi" | "bb" | "macd")[];
  };
  /** Estä sisäänmeno heti tappiokierroksen jälkeen (symbolikohtainen). */
  blockConsecutiveLoss?: {
    enabled?: boolean;
    skipEntries?: number;
    cooldownMinutes?: number;
    /** Minuutit ilman uutta entryä STOP_LOSS-sulun jälkeen (whipsaw). Oletus 20. */
    cooldownAfterStopLossMinutes?: number;
  };
  /** Churn-suoja: max kauppaa / päivä + min väli entryjen välillä. */
  tradeRateLimit?: {
    enabled?: boolean;
    maxTradesPerDay?: number;
    minMinutesBetweenEntries?: number;
  };
  /** Extreme: adaptiivinen EUR-ping-pong (volatiliteetti + trendi). */
  extreme?: {
    sellProfitQuote?: number;
    buyMoveQuote?: number;
    stopLossQuote?: number;
    volatilityScale?: boolean;
    volatilityLookback?: number;
    trendAdjust?: boolean;
    maxCashCandles?: number;
    maxLongCandles?: number;
    /** Päivää ilman kauppaa → pakota seuraava askel (0 = pois). */
    idleForceDays?: number;
    /** Ylikirjoittaa päivät kynttilöinä. */
    idleForceCandles?: number;
  };
  grid: GridLevel[];
  gridOrderSize: number;
  gridRebalance: boolean;
  gridLevels: number;
  gridRange: {
    upper: number;
    lower: number;
  };
  gridDensity: "uniform" | "concentrated" | undefined;
  indicators?: {
    sma?: {
      enabled: boolean;
      length: number;
      weight?: number;
    };
    adx?: {
      enabled: boolean;
      dilength: number;
      adxSmoothing: number;
      weight?: number;
      plusDI?: {
        length: number;
      }
      minusDI?: {
        length: number;
      }
    };
    renko?: {
      enabled: boolean;
      weight: number;
      multiplier: number;
      brickSize: number;
    };
    ema?: {
      enabled?: boolean;
      short: number;
      long: number;
      weight?: number;
    };
    macd?: {
      enabled: boolean;
      fast: number;
      slow: number;
      signal: number;
      weight?: number;
      skipHistogram?: boolean;
    };
    rsi?: {
      enabled: boolean;
      length: number;
      smoothing?: {
        type: "EMA" | "SMA";
        length: number;
      };
      history: number;
      tresholds: {
        overbought: number;
        oversold: number;
      };
      weight?: number;
    };
    atr?: {
      enabled: boolean;
      length: number;
      weight?: number;
    };
    obv?: {
      enabled: boolean;
      length: number;
      weight?: number;
    };
    cmf?: {
      enabled: boolean;
      length: number;
      history: number;
      tresholds: {
        overbought: number;
        oversold: number;
      };
      weight?: number;
    };
    bb?: {
      enabled: boolean;
      length: number;
      multiplier: number;
      average: "SMA" | "EMA";
      history: number;
      weight?: number;
    };
    so?: {
      enabled: boolean;
      kPeriod: number;
      dPeriod: number;
      smoothing: number;
      tresholds: {
        overbought: number;
        oversold: number;
      };
      weight?: number;
    };
    srsi?: {
      enabled: boolean;
      rsiLength: number;
      stochLength: number;
      kPeriod: number;
      dPeriod: number;
      smoothK: number;
      smoothD: number;
      history: number;
      tresholds: {
        overbought: number;
        oversold: number;
      };
      weight?: number;
    };
    dmi?: {
      enabled: boolean;
      dmiLength: number;
      adxSmoothing: number;
      weight?: number;
    };
    OpenAI?: {
      enabled: boolean;
      key: string;
      model: string;
      history: string;
      overwrite: boolean;
    };
  };
}

/** Poista hilowFixed.stopLossQuote jos tyhjä/0 — estää vanhan arvon jäämisen merge-tallennuksessa. */
export function normalizeHilowFixedOptions(sym: SymbolOptions): void {
  const hf = sym.hilowFixed;
  if (!hf || typeof hf !== "object") return;
  const sl = Number(hf.stopLossQuote);
  if (!Number.isFinite(sl) || sl <= 0) {
    delete hf.stopLossQuote;
  }
}

export function normalizeBbAverage(sym: SymbolOptions): void {
  const bb = sym.indicators?.bb;
  if (!bb) return;
  if (bb.average !== "EMA") {
    bb.average = "SMA";
  }
}

export function normalizeExtremeOptions(sym: SymbolOptions): void {
  const ex = sym.extreme;
  if (!ex || typeof ex !== "object") return;
  const sl = Number(ex.stopLossQuote);
  if (!Number.isFinite(sl) || sl <= 0) {
    delete ex.stopLossQuote;
  }
}

export interface DiscordOptions {
  enabled?: boolean;
  token?: string;
  applicationId?: string;
  serverId?: string;
  channelId?: string;
}

/** Simulaatio-grid: useita parametriyhdistelmiä samalla kynttilähistorialla (CLI / simulaatio-UI). */
export interface SimGridOptions {
  /** Kun true: simulaatio-UI voi käynnistää grid-ajon (POST /simulate/grid). */
  enabled?: boolean;
  /** Polku projektin juureen (esim. settings/sim-grid.example.json). */
  configPath?: string;
}

export interface ConfigOptions {
  running: boolean;
  debug: boolean;
  startTime: string;
  exchanges: ExchangeOptions[];
  license: string;
  simulate: boolean;
  discord: DiscordOptions;
  discordSecondary?: DiscordOptions;
  /** When true, no real orders are placed (dry run). */
  dryRun?: boolean;
  /**
   * Simulaatio: käytä vain kynttilöitä, joiden aika on viimeisen N vuoden sisällä (esim. 2 = viimeiset 2 vuotta).
   * Murto-osat sallittu: 1/12 ≈ 1 kk, 0.5 = 6 kk.
   * Pois, 0 tai negatiivinen = koko ladattu historia (Binance Vision ~2020 → nykyhetki).
   */
  simulationHistoryYears?: number;
  simGrid?: SimGridOptions;
  /**
   * Sim Yhteenveto / copy-symbol→live — symbolitason polut (camelCase, pistepolku esim. `takeProfit.target`).
   * Jos lista ei-tyhjä: PATCHistä päivitetään vain nämät polut; muu säilyy live-symbolista.
   * Tyhjä / puuttuu = täydellinen sulautus (PATCH + aiempi käyttäjälogi).
   */
  simPatchMergeAllowPaths?: string[];
  /**
   * Nämä PATHit kopioidaan aina PATCHin ja allowlist-merge jälkeen takaisin LIVE-symbolista
   * (PATCH ei saa päivittää esim. `apiKeys` tai `timeframes`).
   */
  simPreservePathsOnLiveMerge?: string[];
  [key: string]:
    | ExchangeOptions[]
    | DiscordOptions
    | string
    | string[]
    | number
    | boolean
    | undefined
    | number
    | TradeHistory
    | Orderbooks
    | Balances
    | OpenOrders
    | SimGridOptions; // Index signature
}

/** Poistettu TP-kentät — eivät enää vaikuta logiikkaan eivätkä säily mergeissä. */
const LEGACY_TAKE_PROFIT_KEYS = ["dropMinUnrealized"] as const;

export function stripLegacyTakeProfitFields(tp: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!tp || typeof tp !== "object") return tp;
  const out = { ...tp };
  for (const k of LEGACY_TAKE_PROFIT_KEYS) {
    delete out[k];
  }
  return out;
}

/** Poista legacy TP-kentät kaikista symboleista ennen tiedostoon kirjoitusta. */
export function sanitizeOptionsDocument(options: ConfigOptions): ConfigOptions {
  const out = JSON.parse(JSON.stringify(options)) as ConfigOptions;
  for (const ex of out.exchanges ?? []) {
    for (const sym of ex.symbols ?? []) {
      if (!sym || typeof sym !== "object") continue;
      if (sym.takeProfit) {
        sym.takeProfit = stripLegacyTakeProfitFields(sym.takeProfit as Record<string, unknown>) as SymbolOptions["takeProfit"];
      }
      if (sym.takeProfitBuy) {
        sym.takeProfitBuy = stripLegacyTakeProfitFields(
          sym.takeProfitBuy as Record<string, unknown>
        ) as SymbolOptions["takeProfitBuy"];
      }
      // Runtime flags must not persist across restarts / disk writes.
      if (sym.stopLoss && typeof sym.stopLoss === "object") {
        sym.stopLoss.hit = false;
      }
      if (sym.stopLossBuy && typeof sym.stopLossBuy === "object") {
        delete (sym.stopLossBuy as { hit?: boolean }).hit;
      }
      if (sym.takeProfit && typeof sym.takeProfit === "object") {
        sym.takeProfit.current = 0;
      }
      if (sym.takeProfitBuy && typeof sym.takeProfitBuy === "object") {
        sym.takeProfitBuy.current = 0;
      }
    }
  }
  return out;
}

/** Validates options after load. Logs warnings and normalizes structure to avoid runtime errors. */
export const validateOptions = (options: ConfigOptions): ConfigOptions => {
  if (!options || typeof options !== "object") {
    return { running: false, debug: false, startTime: "", exchanges: [], license: "", simulate: false, discord: {} };
  }
  if (!Array.isArray(options.exchanges)) {
    options.exchanges = [];
  }
  for (let i = 0; i < options.exchanges.length; i++) {
    const ex = options.exchanges[i];
    if (!ex || typeof ex !== "object") continue;
    if (!ex.name) ex.name = "";
    if (!ex.mode) ex.mode = "algorithmic";
    if (
      ex.mode === "algorithmic" ||
      ex.mode === "hilow" ||
      ex.mode === "extreme" ||
      ex.mode === "periodic"
    ) {
      if (!Array.isArray(ex.symbols)) ex.symbols = [];
      for (let j = 0; j < ex.symbols.length; j++) {
        const sym = ex.symbols[j];
        if (sym && typeof sym === "object" && !sym.name) (sym as SymbolOptions).name = "";
        if (sym?.takeProfit) {
          sym.takeProfit = stripLegacyTakeProfitFields(sym.takeProfit as Record<string, unknown>) as SymbolOptions["takeProfit"];
        }
        if (sym?.takeProfitBuy) {
          sym.takeProfitBuy = stripLegacyTakeProfitFields(
            sym.takeProfitBuy as Record<string, unknown>
          ) as SymbolOptions["takeProfitBuy"];
        }
        if (sym) {
          normalizeHilowFixedOptions(sym);
          normalizeExtremeOptions(sym);
          if (options.simulate === true) {
            normalizeSimulationSymbolDefaults(sym);
          }
          if (ex.mode === "algorithmic" && shouldApplyComplementaryIndicators(sym)) {
            applyRecommendedAlgorithmicIndicators(sym);
          }
          normalizeBbAverage(sym);
          if (ex.mode === "algorithmic") {
            normalizeAlgorithmicIndicatorParams(sym);
            normalizeScoutConfirmTimeframes(sym);
          }
        }
        if (sym.takeProfit?.enabled && (sym.takeProfit.drop ?? 0) <= 0) {
          console.warn(`[Hoobot] ${sym.name}: takeProfit enabled but drop <= 0 — trailing TP disabled.`);
        }
        if (sym.takeProfit?.enabled && (sym.takeProfit.minimum ?? 0) < 0) {
          console.warn(`[Hoobot] ${sym.name}: takeProfit.minimum is negative.`);
        }
        if (sym.stopLoss?.enabled && (sym.stopLoss.pnl ?? 0) > 0) {
          console.warn(`[Hoobot] ${sym.name}: stopLoss.pnl should be <= 0 (got ${sym.stopLoss.pnl}).`);
        }
        if (!Array.isArray(sym.timeframes) || sym.timeframes.length === 0) {
          console.warn(`[Hoobot] ${sym.name}: timeframes missing or empty.`);
        }
        if (sym.agreement != null && (sym.agreement < 0 || sym.agreement > 100)) {
          console.warn(`[Hoobot] ${sym.name}: agreement should be 0–100.`);
        }
        if (sym.scoutConfirm?.enabled === true) {
          const st = sym.scoutConfirm.scoutTimeframe;
          const ct = sym.scoutConfirm.confirmTimeframe;
          if (st && ct && st === ct) {
            console.warn(`[Hoobot] ${sym.name}: scoutConfirm scout and confirm timeframe are identical (${st}).`);
          }
          const tfs = sym.timeframes ?? [];
          if (ct && !tfs.includes(ct)) {
            console.warn(`[Hoobot] ${sym.name}: confirm timeframe ${ct} missing from timeframes.`);
          }
          if (st && !tfs.includes(st)) {
            console.warn(`[Hoobot] ${sym.name}: scout timeframe ${st} missing from timeframes.`);
          }
        }
        const tpMin = sym.takeProfit?.minimum ?? 0;
        if (sym.takeProfit?.enabled && tpMin >= 1.5) {
          console.warn(
            `[Hoobot] ${sym.name}: takeProfit.minimum=${tpMin}% is high for 3m scalping — expect sparse trades.`
          );
        }
        // Scout + TP min are intentional together around 1%; warn only when both are very strict.
        if (sym.scoutConfirm?.enabled === true && tpMin > 1.2 && sym.takeProfit?.enabled) {
          console.warn(
            `[Hoobot] ${sym.name}: scoutConfirm + takeProfit.minimum=${tpMin}% — overlapping strict filters.`
          );
        }
        if (sym.profit?.enabled === true) {
          const feeFloor = roundTripFeePct(sym.tradeFeePercentage) + 0.05;
          if (!sym.profit) sym.profit = { enabled: true, minimumSell: feeFloor, minimumBuy: feeFloor };
          for (const side of ["minimumSell", "minimumBuy"] as const) {
            const raw = Number(sym.profit[side] ?? 0);
            if (!Number.isFinite(raw) || raw < feeFloor) {
              console.warn(
                `[Hoobot] ${sym.name}: profit.${side}=${raw} raised to fee floor ${feeFloor.toFixed(3)}% (round-trip fee + 0.05).`
              );
              sym.profit[side] = feeFloor;
            }
          }
        }
        // stopLoss vs stopLossBuy may be intentionally asymmetric (wide long SL, tight short SL).
        // Do not auto-widen stopLossBuy — warn only.
        if (sym.stopLossBuy?.enabled && sym.stopLoss?.enabled) {
          const sl = Math.abs(Number(sym.stopLoss.pnl ?? 0));
          const slBuy = Math.abs(Number(sym.stopLossBuy.pnl ?? 0));
          if (sl > 0 && slBuy > 0 && slBuy < sl * 0.6) {
            console.warn(
              `[Hoobot] ${sym.name}: stopLossBuy.pnl=${sym.stopLossBuy.pnl} much tighter than stopLoss.pnl=${sym.stopLoss.pnl} (intentional asymmetry OK).`
            );
          }
        }
        if ((sym.maximumAgeOfOrder ?? 0) <= 0 && ex.mode === "algorithmic") {
          console.warn(`[Hoobot] ${sym.name}: maximumAgeOfOrder missing — open-order guard may misbehave.`);
        }
        // Voting indicators: enabled requires weight > 0 (ATR is volatility-only, not a vote).
        if (sym.indicators && typeof sym.indicators === "object") {
          const votingKeys = [
            "sma",
            "ema",
            "adx",
            "macd",
            "rsi",
            "so",
            "srsi",
            "bb",
            "obv",
            "cmf",
            "renko",
            "dmi",
          ] as const;
          for (const key of votingKeys) {
            const ind = sym.indicators[key] as { enabled?: boolean; weight?: number } | undefined;
            if (!ind || ind.enabled !== true) continue;
            const w = Number(ind.weight);
            if (!Number.isFinite(w) || w <= 0) {
              console.warn(
                `[Hoobot] ${sym.name}: indicators.${key} enabled but weight=${ind.weight} — disabling (weight must be > 0).`
              );
              ind.enabled = false;
            }
          }
        }
        if (sym.liveOrderExecution) {
          sym.liveOrderExecution = normalizeLiveOrderExecution(sym.name ?? "", sym.liveOrderExecution);
          if (options.simulate === true) {
            console.warn(
              `[Hoobot] ${sym.name}: liveOrderExecution is ignored in simulation (instant fill at candle price).`
            );
          }
        }
      }
    }
  }
  if (!options.discord || typeof options.discord !== "object") options.discord = {};
  if (options.simGrid != null && typeof options.simGrid === "object") {
    const g = options.simGrid;
    if (g.enabled === undefined) g.enabled = false;
    if (typeof g.configPath !== "string" || g.configPath.trim() === "") {
      g.configPath = "settings/sim-grid.example.json";
    }
  }
  return options;
};

/** Symbolit joiden `enabled !== false` (vanhoissa asetuksissa kenttä puuttuu = treidataan). */
export const symbolsActiveForTrading = (symbols: SymbolOptions[] | undefined): SymbolOptions[] =>
  (symbols ?? []).filter((s) => s && s.enabled !== false);

/** Syväkopio; exchange key/secret → "***" (grid-/sim-tulostiedostot). */
export const maskConfigSecretsForExport = (options: ConfigOptions): ConfigOptions => {
  const out = JSON.parse(JSON.stringify(options)) as ConfigOptions;
  const exchanges = out.exchanges;
  if (Array.isArray(exchanges)) {
    for (const ex of exchanges) {
      if (ex && typeof ex === "object") {
        if (typeof ex.key === "string" && ex.key.length > 0) ex.key = "***";
        if (typeof ex.secret === "string" && ex.secret.length > 0) ex.secret = "***";
      }
    }
  }
  return out;
};

/** Baseline/grid-vienti käyttää "***" — ei kelpaa Binancen API-avaimeksi. */
export const isMaskedExchangeCredential = (value: unknown): boolean =>
  typeof value !== "string" || value.length === 0 || value === "***";

/** Säilytä live-pörssin oikeat key/secret kun baseline sisältää vain maskatut arvot. */
export const preserveExchangeCredentialsFromLive = (
  incomingExchanges: ExchangeOptions[],
  liveExchanges: ExchangeOptions[]
): ExchangeOptions[] => {
  const liveByName = new Map<string, ExchangeOptions>();
  for (const ex of liveExchanges) {
    if (ex?.name) liveByName.set(ex.name, ex);
  }
  return incomingExchanges.map((inEx) => {
    const out = JSON.parse(JSON.stringify(inEx)) as ExchangeOptions;
    const liveEx = inEx.name ? liveByName.get(inEx.name) : undefined;
    for (const field of ["key", "secret"] as const) {
      const liveVal = liveEx?.[field];
      const inVal = out[field];
      if (typeof liveVal === "string" && liveVal.length > 0 && !isMaskedExchangeCredential(liveVal)) {
        out[field] = liveVal;
      } else if (isMaskedExchangeCredential(inVal)) {
        out[field] = "";
      }
    }
    return out;
  });
};

/** Baseline → live: älä korvaa live-symbolin growingMax-arvoja baselin mukaan. */
export const preserveLiveGrowingMaxOnBaselineExchanges = (
  incomingExchanges: ExchangeOptions[],
  liveExchanges: ExchangeOptions[]
): ExchangeOptions[] => {
  const liveGrowingMaxByKey = new Map<string, NonNullable<SymbolOptions["growingMax"]>>();
  for (const ex of liveExchanges) {
    if (!ex?.name || !Array.isArray(ex.symbols)) continue;
    for (const sym of ex.symbols) {
      if (!sym?.name || sym.growingMax === undefined) continue;
      liveGrowingMaxByKey.set(`${ex.name}\0${sym.name}`, sym.growingMax);
    }
  }
  for (const ex of incomingExchanges) {
    if (!ex?.name || !Array.isArray(ex.symbols)) continue;
    for (const sym of ex.symbols) {
      if (!sym?.name) continue;
      const liveGm = liveGrowingMaxByKey.get(`${ex.name}\0${sym.name}`);
      if (liveGm !== undefined) {
        sym.growingMax = JSON.parse(JSON.stringify(liveGm)) as SymbolOptions["growingMax"];
      } else {
        delete sym.growingMax;
      }
    }
  }
  return incomingExchanges;
};

export const SETTINGS_LIVE_OPTIONS_BASENAME = "hoobot-options.json";

/** SIMULATE=true -istunnon oma asennustiedosto (ei live-bottia). */
export const SETTINGS_SIMULATE_OPTIONS_BASENAME = "hoobot-options-simulate.json";

export function getLiveOptionsFilePath(): string {
  return join(findProjectRoot(), "settings", SETTINGS_LIVE_OPTIONS_BASENAME);
}

export function getSimulateOptionsFilePath(): string {
  return join(findProjectRoot(), "settings", SETTINGS_SIMULATE_OPTIONS_BASENAME);
}

/**
 * Etsii projektin juuren: hakemisto jossa on settings/ ja hoobot-options*.json.
 * Kävelee process.cwd() ylöspäin (esim. build/ → projektin juuri).
 */
export function findProjectRoot(): string {
  let dir = resolve(process.cwd());
  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    if (seen.has(dir)) break;
    seen.add(dir);
    const settingsDir = join(dir, "settings");
    if (fs.existsSync(settingsDir)) {
      const marker = join(settingsDir, SETTINGS_LIVE_OPTIONS_BASENAME);
      const markerSim = join(settingsDir, SETTINGS_SIMULATE_OPTIONS_BASENAME);
      if (fs.existsSync(marker) || fs.existsSync(markerSim)) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd());
}

/** Suhteellinen polku projektin juureen (tai absoluuttinen sellaisenaan). */
export function resolveProjectRelativePath(relPath: string): string {
  const normalized = String(relPath ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!normalized) {
    return join(findProjectRoot(), "settings", "sim-grid.example.json");
  }
  if (isAbsolute(normalized)) {
    return normalized;
  }
  return resolve(findProjectRoot(), normalized);
}

const readConfigJsonFile = (filePath: string): Record<string, unknown> | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const configHasExchanges = (doc: Record<string, unknown> | null | undefined): boolean =>
  Array.isArray(doc?.exchanges) && (doc!.exchanges as unknown[]).length > 0;

/** Kun simulate-tiedosto on tyhjä: ota livestä vain ensimmäinen enabled-symboli per pörssi (ei kaikkia live-pareja). */
const seedSimExchangesFromLive = (liveDoc: Record<string, unknown>): unknown[] => {
  const exchanges = liveDoc.exchanges;
  if (!Array.isArray(exchanges)) return [];
  const out: unknown[] = [];
  for (const rawEx of exchanges) {
    if (rawEx == null || typeof rawEx !== "object") continue;
    const ex = rawEx as Record<string, unknown>;
    const symbols = ex.symbols;
    if (!Array.isArray(symbols)) continue;
    const enabled = symbols.filter(
      (s) => s != null && typeof s === "object" && (s as { enabled?: boolean }).enabled !== false
    );
    if (enabled.length === 0) continue;
    out.push({ ...ex, symbols: [JSON.parse(JSON.stringify(enabled[0]))] });
  }
  return out;
};

/**
 * Sim-UI / parseArgsSimulate: lue hoobot-options-simulate.json.
 * Jos simulate-tiedosto on olemassa mutta exchanges on tyhjä, täydennä yhdellä live-symbolilla
 * (simGrid ym. säilyvät simulate-tiedostosta). Ei koskaan sekoita koko live-listaa simulateen.
 */
export const loadSimulateSettingsDocument = (): Record<string, unknown> => {
  const simPath = getSimulateOptionsFilePath();
  const livePath = getLiveOptionsFilePath();
  const simDoc = readConfigJsonFile(simPath);
  const liveDoc = readConfigJsonFile(livePath);

  let doc: Record<string, unknown>;
  if (simDoc && configHasExchanges(simDoc)) {
    doc = { ...simDoc, simulate: true };
  } else if (simDoc && liveDoc && configHasExchanges(liveDoc)) {
    doc = {
      ...liveDoc,
      ...simDoc,
      exchanges: seedSimExchangesFromLive(liveDoc),
      simulate: true,
    };
  } else if (simDoc) {
    doc = { ...simDoc, simulate: true };
  } else if (liveDoc) {
    doc = { ...liveDoc, simulate: true };
  } else {
    return { simulate: true, exchanges: [] };
  }

  if (liveDoc && configHasExchanges(doc) && configHasExchanges(liveDoc)) {
    const simExchanges = doc.exchanges as ExchangeOptions[];
    const liveExchanges = liveDoc.exchanges as ExchangeOptions[];
    doc.exchanges = preserveExchangeCredentialsFromLive(simExchanges, liveExchanges);
  }
  return doc;
};

/** Älä tallenna API-avaimia simulate-tiedostoon (ladataan tarvittaessa livestä). */
export const stripExchangeCredentialsForSimulatePersist = (options: ConfigOptions): ConfigOptions => {
  const out = JSON.parse(JSON.stringify(options)) as ConfigOptions;
  for (const ex of out.exchanges ?? []) {
    if (!ex || typeof ex !== "object") continue;
    ex.key = "";
    ex.secret = "";
  }
  return out;
};

/**
 * Simulaation asetukset: ensisijaisesti settings/hoobot-options-simulate.json.
 * Jos sitä ei ole tai exchanges on tyhjä, käytetään live-tiedoston pörssejä.
 */
export const parseArgsSimulate = (): ConfigOptions => {
  let options: ConfigOptions = {
    running: false,
    debug: false,
    startTime: "",
    exchanges: [],
    license: "",
    simulate: true,
    discord: {},
  };
  try {
    const loaded = loadSimulateSettingsDocument();
    options = loaded as unknown as ConfigOptions;
    options.simulate = true;
    options = validateOptions(options);
    for (let i = 0; i < options.exchanges.length; i++) {
      options.exchanges[i].tradeHistory = options.exchanges[i].tradeHistory ?? {};
    }
  } catch (error) {
    logToFile("./logs/error.log", JSON.stringify(error, null, 4));
    console.error(JSON.stringify(error, null, 4));
  }
  return options;
};

export const parseArgs = (): ConfigOptions => {
  var options: ConfigOptions = {
    running: false,
    debug: false,
    startTime: "",
    exchanges: [],
    license: "",
    simulate: process.env.SIMULATE === "true" ? true : false,
    discord: {},
  };
  try {
    const optionsFilename = getLiveOptionsFilePath();
    if (fs.existsSync(optionsFilename)) {
      const optionsFile = fs.readFileSync(optionsFilename);
      options = JSON.parse(optionsFile.toString("utf-8"));
    }
    if (process.env.SIMULATE === "true") {
      options.simulate = true;
    }
    options = validateOptions(options);
    for (let i = 0; i < options.exchanges.length; i++) {
      options.exchanges[i].tradeHistory = options.exchanges[i].tradeHistory ?? {};
    }
  } catch (error) {
    logToFile("./logs/error.log", JSON.stringify(error, null, 4));
    console.error(JSON.stringify(error, null, 4));
  }

  return options;
};
