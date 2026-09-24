/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { SymbolOptions } from "../Utilities/Args";
import {
  getTakeProfitRuntimeState,
  markTakeProfitPartialTaken,
  resolveTakeProfitLeg,
  type TakeProfitLeg,
} from "../Indicators/takeProfitPositionState";
import { toSymbolKey } from "../Utilities/Args";
import { LIVE_BASE_RESERVE } from "./executionSizing";
import { recordPartialTpEvent } from "./partialTpStats";

export type PartialCloseConfig = {
  enabled?: boolean;
  /** Osuus positosta ensimmäisellä TAKE_PROFIT-sululla (0–1). Oletus 0.5. */
  fraction?: number;
};

const resolveCfg = (symbolOptions: SymbolOptions, leg: TakeProfitLeg): PartialCloseConfig | undefined => {
  if (leg === "buy") {
    return (symbolOptions.takeProfitBuy as { partialClose?: PartialCloseConfig } | undefined)?.partialClose;
  }
  return (symbolOptions.takeProfit as { partialClose?: PartialCloseConfig } | undefined)?.partialClose;
};

export const resolvePartialCloseFraction = (cfg?: PartialCloseConfig): number => {
  const raw = Number(cfg?.fraction);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.5;
};

/**
 * Ensimmäinen TAKE_PROFIT (ei FORCE): osittainen sulku jos partialClose.enabled.
 * Toinen TP / FORCE / STOP_LOSS: täysi sulku.
 */
export const shouldUsePartialTakeProfitClose = (
  symbolOptions: SymbolOptions,
  profit: string,
  next: "SELL" | "BUY"
): boolean => {
  if (profit !== "TAKE_PROFIT") return false;
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  const cfg = resolveCfg(symbolOptions, leg);
  if (cfg?.enabled !== true) return false;
  const symbolKey = toSymbolKey(symbolOptions.name);
  const runtime = getTakeProfitRuntimeState(symbolKey, leg);
  return runtime.partialTaken !== true;
};

/** Palauta forceQuantityInBase osittaiselle TP:lle, tai undefined = täysi positio. */
export const resolvePartialTakeProfitBaseQty = (
  baseBalance: number,
  symbolOptions: SymbolOptions,
  profit: string,
  next: "SELL" | "BUY"
): number | undefined => {
  if (!shouldUsePartialTakeProfitClose(symbolOptions, profit, next)) return undefined;
  if (!(baseBalance > 0)) return undefined;
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  const fraction = resolvePartialCloseFraction(resolveCfg(symbolOptions, leg));
  const qty = baseBalance * fraction * LIVE_BASE_RESERVE;
  return qty > 0 ? qty : undefined;
};

/** Kutsu täyttymisen jälkeen: merkitse partial tai palauta true jos TP-runtime pitää säilyttää. */
export const noteTakeProfitFillOutcome = (
  symbolOptions: SymbolOptions,
  profit: string,
  next: "SELL" | "BUY",
  usedPartialQty: boolean
): { preserveRuntime: boolean } => {
  if (!usedPartialQty) return { preserveRuntime: false };
  if (profit !== "TAKE_PROFIT") return { preserveRuntime: false };
  const symbolKey = toSymbolKey(symbolOptions.name);
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  markTakeProfitPartialTaken(symbolKey, leg);
  recordPartialTpEvent(symbolKey, "firstPartial");
  return { preserveRuntime: true };
};

/** Täysi TP-sulku (ei osittainen): tilastoi remainder vs full. */
export const noteFullTakeProfitClose = (
  symbolOptions: SymbolOptions,
  profit: string,
  next: "SELL" | "BUY",
  pnlPct?: number
): void => {
  if (profit !== "TAKE_PROFIT" && profit !== "TAKE_PROFIT_FORCE") return;
  const symbolKey = toSymbolKey(symbolOptions.name);
  const leg = resolveTakeProfitLeg(symbolOptions, next);
  const wasPartial = getTakeProfitRuntimeState(symbolKey, leg).partialTaken === true;
  if (wasPartial) recordPartialTpEvent(symbolKey, "remainderClose", pnlPct);
  else recordPartialTpEvent(symbolKey, "fullTp", pnlPct);
};
