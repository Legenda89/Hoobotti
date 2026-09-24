/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import fs from "fs";
import { dirname, join } from "node:path";
import type { Trade } from "../Exchanges/Trades";
import {
  calculatePNLPercentageForLong,
  calculatePNLPercentageForShort,
} from "../Exchanges/Trades";
import type { SymbolOptions } from "../Utilities/Args";
import { findProjectRoot } from "../Utilities/Args";
import { isPartialTakeProfitRemainderOpen } from "./positionState";
import { roundTripPnlAfterFees } from "./tradeGates";

export type BlockConsecutiveLossConfig = {
  enabled?: boolean;
  /** Montako sisäänmenoyritystä ohitetaan cooldownin jälkeen (oletus 1). */
  skipEntries?: number;
  /** Tauko minuutteina heti tappiokierroksen jälkeen (oletus 15). */
  cooldownMinutes?: number;
  /** Tauko minuutteina STOP_LOSS-sulun jälkeen — estää whipsaw-entryt (oletus 20, 0 = pois). */
  cooldownAfterStopLossMinutes?: number;
};

type RuntimeEntry = {
  skipRemaining: number;
  blockedUntilMs: number;
  stopLossBlockedUntilMs: number;
};

export type ConsecutiveLossStatus = {
  active: boolean;
  skipRemaining: number;
  blockedUntilMs: number;
  cooldownRemainingMinutes: number;
};

export type StopLossCooldownStatus = {
  active: boolean;
  blockedUntilMs: number;
  cooldownRemainingMinutes: number;
};

const runtimeFilePath = (): string => join(findProjectRoot(), "settings", "consecutive-loss-runtime.json");
const runtimeBySymbol = new Map<string, RuntimeEntry>();
let diskLoaded = false;

const ensureLoaded = (): void => {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const RUNTIME_FILE = runtimeFilePath();
    if (!fs.existsSync(RUNTIME_FILE)) return;
    const raw = fs.readFileSync(RUNTIME_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, RuntimeEntry>;
    for (const [key, val] of Object.entries(parsed)) {
      if (!val || typeof val !== "object") continue;
      const skipRemaining = Number(val.skipRemaining);
      const blockedUntilMs = Number(val.blockedUntilMs);
      if (!Number.isFinite(blockedUntilMs)) continue;
      runtimeBySymbol.set(key, {
        skipRemaining: Number.isFinite(skipRemaining) && skipRemaining > 0 ? Math.floor(skipRemaining) : 0,
        blockedUntilMs,
        stopLossBlockedUntilMs: Number.isFinite(Number(val.stopLossBlockedUntilMs))
          ? Number(val.stopLossBlockedUntilMs)
          : 0,
      });
    }
  } catch {
    // ignore corrupt runtime file
  }
};

const persistRuntime = (): void => {
  ensureLoaded();
  try {
    const RUNTIME_FILE = runtimeFilePath();
    const dir = dirname(RUNTIME_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const out: Record<string, RuntimeEntry> = {};
    for (const [key, val] of runtimeBySymbol.entries()) {
      if (val.skipRemaining > 0 || val.blockedUntilMs > Date.now() || val.stopLossBlockedUntilMs > Date.now()) {
        out[key] = val;
      }
    }
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(out, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
};

export const initConsecutiveLossGuard = (): void => {
  ensureLoaded();
};

export const resetConsecutiveLossGuard = (symbolKey?: string): void => {
  ensureLoaded();
  if (symbolKey) {
    runtimeBySymbol.delete(symbolKey);
  } else {
    runtimeBySymbol.clear();
  }
  persistRuntime();
};

export const resolveBlockConsecutiveLossConfig = (
  symbolOptions: SymbolOptions
): Required<
  Pick<BlockConsecutiveLossConfig, "enabled" | "skipEntries" | "cooldownMinutes" | "cooldownAfterStopLossMinutes">
> => {
  const raw = symbolOptions.blockConsecutiveLoss;
  const skipRaw = Number(raw?.skipEntries);
  const cooldownRaw = Number(raw?.cooldownMinutes);
  const slCooldownRaw = Number(raw?.cooldownAfterStopLossMinutes);
  return {
    enabled: raw?.enabled === true,
    skipEntries: Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 1,
    cooldownMinutes: Number.isFinite(cooldownRaw) && cooldownRaw >= 0 ? cooldownRaw : 15,
    cooldownAfterStopLossMinutes:
      Number.isFinite(slCooldownRaw) && slCooldownRaw >= 0 ? slCooldownRaw : 20,
  };
};

/** Viimeisin suljettu round-trip (buy→sell tai sell→buy) nettoprosentteina. */
export const lastCompletedRoundTripPnlPct = (
  trades: Trade[] | undefined,
  tradeFeePercentage?: number
): number | undefined => {
  if (!trades || trades.length < 2) return undefined;
  const last = trades[trades.length - 1]!;
  const older = trades[trades.length - 2]!;
  let gross: number | undefined;
  if (older.isBuyer && !last.isBuyer) {
    gross = calculatePNLPercentageForLong(parseFloat(older.price), parseFloat(last.price));
  } else if (!older.isBuyer && last.isBuyer) {
    gross = calculatePNLPercentageForShort(parseFloat(older.price), parseFloat(last.price));
  }
  if (gross === undefined || !Number.isFinite(gross)) return undefined;
  return roundTripPnlAfterFees(gross, older, last, tradeFeePercentage);
};

/**
 * Uusi avaus loss/rate-guardeille (ei TP/SL/time-stop -sulku).
 * Longin pehmennetty sulku (SELL+SELL) ei ole entry — muuten consecutive-loss estää myynnin.
 */
export const isAlgorithmicEntryTrade = (direction: string, profit: string): boolean => {
  if (
    profit === "STOP_LOSS" ||
    profit === "TAKE_PROFIT" ||
    profit === "TAKE_PROFIT_FORCE" ||
    profit === "STALE_EXIT"
  ) {
    return false;
  }
  if (direction === "SELL" && profit === "SELL") return false;
  if (direction === "BUY") return profit === "SKIP" || profit === "BUY";
  if (direction === "SELL") return profit === "SKIP";
  return false;
};

const getOrCreateRuntime = (symbolKey: string): RuntimeEntry => {
  ensureLoaded();
  let entry = runtimeBySymbol.get(symbolKey);
  if (!entry) {
    entry = { skipRemaining: 0, blockedUntilMs: 0, stopLossBlockedUntilMs: 0 };
    runtimeBySymbol.set(symbolKey, entry);
  }
  return entry;
};

/** Kutsu kun round-trip sulkeutuu tappiolla (sim tai live fill). */
export const registerConsecutiveLossAfterClose = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  roundTripPnlPct: number
): void => {
  const cfg = resolveBlockConsecutiveLossConfig(symbolOptions);
  if (!cfg.enabled || !Number.isFinite(roundTripPnlPct) || roundTripPnlPct >= 0) return;
  const entry = getOrCreateRuntime(symbolKey);
  entry.skipRemaining = cfg.skipEntries;
  entry.blockedUntilMs = Date.now() + cfg.cooldownMinutes * 60 * 1000;
  persistRuntime();
};

/** Kutsu kun positio suljetaan STOP_LOSS-triggerillä (whipsaw-esto). */
export const registerStopLossClose = (symbolKey: string, symbolOptions: SymbolOptions): void => {
  const cfg = resolveBlockConsecutiveLossConfig(symbolOptions);
  if (!cfg.enabled || cfg.cooldownAfterStopLossMinutes <= 0) return;
  const entry = getOrCreateRuntime(symbolKey);
  entry.stopLossBlockedUntilMs = Date.now() + cfg.cooldownAfterStopLossMinutes * 60 * 1000;
  persistRuntime();
};

export const getStopLossCooldownStatus = (symbolKey: string): StopLossCooldownStatus => {
  ensureLoaded();
  const entry = runtimeBySymbol.get(symbolKey);
  const now = Date.now();
  if (!entry || entry.stopLossBlockedUntilMs <= now) {
    return { active: false, blockedUntilMs: 0, cooldownRemainingMinutes: 0 };
  }
  return {
    active: true,
    blockedUntilMs: entry.stopLossBlockedUntilMs,
    cooldownRemainingMinutes: Math.max(0, Math.ceil((entry.stopLossBlockedUntilMs - now) / 60000)),
  };
};

/** Sallitut sulut SL-cooldownin aikana (ei uusia avauksia). */
export const isStopLossCooldownExemptClose = (profit: string, hasOpenPosition: boolean): boolean => {
  if (profit === "STOP_LOSS" || profit === "STALE_EXIT") return true;
  if (hasOpenPosition && (profit === "TAKE_PROFIT" || profit === "TAKE_PROFIT_FORCE")) return true;
  return false;
};

export const shouldBlockStopLossCooldownEntry = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  _direction: string,
  profit: string,
  hasOpenPosition = false
): boolean => {
  const cfg = resolveBlockConsecutiveLossConfig(symbolOptions);
  if (!cfg.enabled || cfg.cooldownAfterStopLossMinutes <= 0) return false;
  if (!getStopLossCooldownStatus(symbolKey).active) return false;
  return !isStopLossCooldownExemptClose(profit, hasOpenPosition);
};

export const recordClosedRoundTripFromHistory = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  trades: Trade[] | undefined
): void => {
  if (isPartialTakeProfitRemainderOpen(symbolKey)) return;
  const pnl = lastCompletedRoundTripPnlPct(trades, symbolOptions.tradeFeePercentage);
  if (pnl != null) {
    registerConsecutiveLossAfterClose(symbolKey, symbolOptions, pnl);
  }
};

export const getConsecutiveLossStatus = (symbolKey: string): ConsecutiveLossStatus => {
  ensureLoaded();
  const entry = runtimeBySymbol.get(symbolKey);
  const now = Date.now();
  if (!entry) {
    return { active: false, skipRemaining: 0, blockedUntilMs: 0, cooldownRemainingMinutes: 0 };
  }
  const cooldownRemainingMinutes =
    entry.blockedUntilMs > now ? Math.max(0, Math.ceil((entry.blockedUntilMs - now) / 60000)) : 0;
  const active = cooldownRemainingMinutes > 0 || entry.skipRemaining > 0;
  return {
    active,
    skipRemaining: entry.skipRemaining,
    blockedUntilMs: entry.blockedUntilMs,
    cooldownRemainingMinutes,
  };
};

/**
 * Estää sisäänmenon tappiokierroksen jälkeen (cooldown + skip-luukut).
 * Cooldownin aikana ei kuluteta skip-luukkuja.
 */
export const shouldBlockConsecutiveLossEntry = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  direction: string,
  profit: string
): boolean => {
  const cfg = resolveBlockConsecutiveLossConfig(symbolOptions);
  if (!cfg.enabled || !isAlgorithmicEntryTrade(direction, profit)) return false;
  ensureLoaded();
  const entry = runtimeBySymbol.get(symbolKey);
  if (!entry) return false;
  const now = Date.now();
  if (now < entry.blockedUntilMs) return true;
  if (entry.skipRemaining > 0) {
    entry.skipRemaining -= 1;
    persistRuntime();
    return true;
  }
  return false;
};

export const consecutiveLossSkipsRemaining = (symbolKey: string): number =>
  getConsecutiveLossStatus(symbolKey).skipRemaining;
