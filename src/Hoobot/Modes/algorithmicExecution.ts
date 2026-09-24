/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Candlesticks } from "../Exchanges/Candlesticks";
import type { Trade } from "../Exchanges/Trades";
import type { SymbolOptions } from "../Utilities/Args";
import { hasOpenPositionFromTradeHistory } from "../Trading/positionState";
import { getLastCompletedCandle, resolveScoutConfirmConfig } from "./scoutConfirm";

export { hasOpenPositionFromTradeHistory };

export type AlgorithmicTickPolicy = {
  runFullDecision: boolean;
  confirmBarStart?: number;
  scoutBarStart?: number;
  reason: string;
};

const symbolLocks = new Map<string, Promise<void>>();
const lastProcessedConfirmBar = new Map<string, number>();
const lastProcessedScoutBar = new Map<string, number>();

export const resetAlgorithmicExecutionRuntime = (symbolKey?: string): void => {
  if (symbolKey) {
    lastProcessedConfirmBar.delete(symbolKey);
    lastProcessedScoutBar.delete(symbolKey);
    return;
  }
  lastProcessedConfirmBar.clear();
  lastProcessedScoutBar.clear();
};

/** Serialize live algorithmic() per symbol (multi-TF websocket). */
export const withSymbolAlgorithmicLock = async <T>(symbolKey: string, fn: () => Promise<T>): Promise<T> => {
  const prev = symbolLocks.get(symbolKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  symbolLocks.set(symbolKey, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (symbolLocks.get(symbolKey) === gate) {
      symbolLocks.delete(symbolKey);
    }
  }
};

export const resolveConfirmTimeframe = (symbolOptions: SymbolOptions): string => {
  const scoutCfg = resolveScoutConfirmConfig(symbolOptions);
  if (scoutCfg.enabled) return scoutCfg.confirmTimeframe;
  return symbolOptions.timeframes?.[0] ?? "3m";
};

const closedBarStart = (series: ReturnType<typeof getLastCompletedCandle>): number | undefined => {
  if (!series) return undefined;
  return series.startTime ?? series.time;
};

/**
 * Live: TP/SL aina kun positio auki.
 * Scout+confirm: entry myös jokaisella uudella 1m-sululla (ei vain 3m).
 * Ilman scoutia: vain uusi confirm-TF sulku.
 */
export const evaluateAlgorithmicTickPolicy = (
  symbolKey: string,
  symbolOptions: SymbolOptions,
  candlesticks: Candlesticks,
  hasOpenPosition: boolean
): AlgorithmicTickPolicy => {
  const confirmTf = resolveConfirmTimeframe(symbolOptions);
  const confirmSeries = candlesticks[symbolKey]?.[confirmTf];
  const confirmClosed = getLastCompletedCandle(confirmSeries);
  const confirmStart = closedBarStart(confirmClosed);

  if (hasOpenPosition) {
    return {
      runFullDecision: true,
      confirmBarStart: confirmStart,
      reason: "open position tp/sl",
    };
  }

  const scoutCfg = resolveScoutConfirmConfig(symbolOptions);
  if (!scoutCfg.enabled) {
    if (confirmStart == null) {
      return { runFullDecision: false, reason: "no closed confirm candle" };
    }
    const prev = lastProcessedConfirmBar.get(symbolKey);
    const isNewConfirmClose = prev !== confirmStart;
    if (isNewConfirmClose) {
      lastProcessedConfirmBar.set(symbolKey, confirmStart);
      return { runFullDecision: true, confirmBarStart: confirmStart, reason: "confirm close" };
    }
    return { runFullDecision: false, confirmBarStart: confirmStart, reason: "wait confirm close" };
  }

  const scoutSeries = candlesticks[symbolKey]?.[scoutCfg.scoutTimeframe];
  const scoutClosed = getLastCompletedCandle(scoutSeries);
  const scoutStart = closedBarStart(scoutClosed);

  if (confirmStart == null && scoutStart == null) {
    return { runFullDecision: false, reason: "no closed scout/confirm candle" };
  }

  const prevConfirm = lastProcessedConfirmBar.get(symbolKey);
  const prevScout = lastProcessedScoutBar.get(symbolKey);
  const isNewConfirm = confirmStart != null && confirmStart !== prevConfirm;
  const isNewScout = scoutStart != null && scoutStart !== prevScout;

  if (isNewConfirm) {
    lastProcessedConfirmBar.set(symbolKey, confirmStart!);
    if (scoutStart != null) {
      lastProcessedScoutBar.set(symbolKey, scoutStart);
    }
    return {
      runFullDecision: true,
      confirmBarStart: confirmStart,
      scoutBarStart: scoutStart,
      reason: "confirm close",
    };
  }

  if (isNewScout) {
    lastProcessedScoutBar.set(symbolKey, scoutStart!);
    return {
      runFullDecision: true,
      confirmBarStart: confirmStart,
      scoutBarStart: scoutStart,
      reason: "scout 1m close",
    };
  }

  return {
    runFullDecision: false,
    confirmBarStart: confirmStart,
    scoutBarStart: scoutStart,
    reason: "wait scout/confirm close",
  };
};

/** Sim replay: päätös vain kun primary/confirm-sarjan suljettu palkki vaihtuu. */
export const evaluateSimAlgorithmicTickPolicy = (
  symbolKey: string,
  _symbolOptions: SymbolOptions,
  primarySeries: { startTime?: number; time: number; isFinal?: boolean }[] | undefined,
  hasOpenPosition: boolean
): AlgorithmicTickPolicy => {
  const closed = getLastCompletedCandle(primarySeries as never);
  const start = closedBarStart(closed);
  if (start == null) {
    return { runFullDecision: false, reason: "no closed primary candle" };
  }
  const prev = lastProcessedConfirmBar.get(symbolKey);
  const isNewClose = prev !== start;
  if (isNewClose) {
    lastProcessedConfirmBar.set(symbolKey, start);
    return { runFullDecision: true, confirmBarStart: start, reason: "sim confirm close" };
  }
  if (hasOpenPosition) {
    return { runFullDecision: true, confirmBarStart: start, reason: "sim open position" };
  }
  return { runFullDecision: false, confirmBarStart: start, reason: "sim wait close" };
};
