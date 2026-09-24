/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Trade } from "../Exchanges/Trades";
import { getTakeProfitRuntimeState } from "../Indicators/takeProfitPositionState";

/**
 * Onko symbolilla avoin positio (ei vain kauppahistoriaa)?
 * Spot long: viimeisin kauppa on osto (base hallussa).
 */
export const hasOpenPositionFromTradeHistory = (trades: Trade[] | undefined): boolean => {
  if (!trades?.length) return false;
  return trades[trades.length - 1]!.isBuyer === true;
};

/** Osittainen TP: ensimmäinen sulku tehty, loput vielä hallussa. */
export const isPartialTakeProfitRemainderOpen = (symbolKey: string): boolean => {
  return (
    getTakeProfitRuntimeState(symbolKey, "sell").partialTaken === true ||
    getTakeProfitRuntimeState(symbolKey, "buy").partialTaken === true
  );
};

/** Avoin positio historiasta tai partial-TP-jäännöksestä. */
export const hasOpenAlgorithmicPosition = (
  trades: Trade[] | undefined,
  symbolKey?: string
): boolean => {
  if (hasOpenPositionFromTradeHistory(trades)) return true;
  if (symbolKey && isPartialTakeProfitRemainderOpen(symbolKey)) return true;
  return false;
};

/**
 * Entry-kauppa avoimelle positiolle.
 * Partial-TP:n jälkeen viimeisin fill on myynti — palauta alkuperäinen osto.
 */
export const resolveOpenPositionEntryTrade = (
  trades: Trade[] | undefined,
  symbolKey?: string
): Trade | undefined => {
  if (!trades?.length) return undefined;
  const last = trades[trades.length - 1]!;
  if (last.isBuyer) return last;
  if (symbolKey && isPartialTakeProfitRemainderOpen(symbolKey)) {
    for (let i = trades.length - 2; i >= 0; i--) {
      if (trades[i]!.isBuyer) return trades[i];
    }
  }
  return undefined;
};

export const hasTradeHistory = (trades: Trade[] | undefined): boolean => (trades?.length ?? 0) > 0;
