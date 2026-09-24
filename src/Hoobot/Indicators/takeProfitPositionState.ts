/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/** SELL-/close-polku vs erillinen BUY-polku (takeProfitBuy.enabled). */
export type TakeProfitLeg = "sell" | "buy";

export type TakeProfitRuntimeState = {
  peakUnrealizedPct: number;
  peakAtMs: number;
  /** Trailing aktivoitu kun unrealized on ylittänyt minimum-kynnyksen. */
  armed: boolean;
  /** Ensimmäinen osittainen TP-sulku tehty — seuraava sulkee loput. */
  partialTaken?: boolean;
};

const stateByKey = new Map<string, TakeProfitRuntimeState>();

export function takeProfitStateKey(symbolKey: string, leg: TakeProfitLeg): string {
  return `${symbolKey}|${leg}`;
}

function getOrCreate(key: string): TakeProfitRuntimeState {
  let state = stateByKey.get(key);
  if (!state) {
    state = { peakUnrealizedPct: 0, peakAtMs: 0, armed: false };
    stateByKey.set(key, state);
  }
  return state;
}

export function getTakeProfitRuntimeState(symbolKey: string, leg: TakeProfitLeg): TakeProfitRuntimeState {
  return { ...getOrCreate(takeProfitStateKey(symbolKey, leg)) };
}

export function markTakeProfitPartialTaken(symbolKey: string, leg: TakeProfitLeg): void {
  const state = getOrCreate(takeProfitStateKey(symbolKey, leg));
  state.partialTaken = true;
}

export function resetTakeProfitRuntimeForSymbol(symbolKey: string): void {
  stateByKey.delete(takeProfitStateKey(symbolKey, "sell"));
  stateByKey.delete(takeProfitStateKey(symbolKey, "buy"));
}

/** Nollaa kaikki TP-runtime (grid-variantti / uusi simulaatioajo). */
export function resetAllTakeProfitRuntime(): void {
  stateByKey.clear();
}

/** Ensimmäisellä tickillä: vanha takeProfit.current → peak (asetustiedoston jäännös). */
function seedFromLegacyCurrent(
  state: TakeProfitRuntimeState,
  tpCfg: { current?: number; minimum?: number } | undefined
): void {
  const legacy = tpCfg?.current;
  if (typeof legacy !== "number" || !Number.isFinite(legacy)) return;
  if (legacy > state.peakUnrealizedPct) {
    state.peakUnrealizedPct = legacy;
    state.peakAtMs = Date.now();
  }
  const min = tpCfg?.minimum ?? 0;
  if (legacy >= min && min > 0) {
    state.armed = true;
  }
}

/**
 * Päivitä positiotila (peak + armed). Synkronoi tpCfg.current lokiin / UI:hin.
 */
export function updateTakeProfitRuntimeState(opts: {
  symbolKey: string;
  leg: TakeProfitLeg;
  unrealizedPNL: number;
  armMinimum: number;
  allowPeakUpdate: boolean;
  tpCfg?: { current?: number; minimum?: number };
}): TakeProfitRuntimeState {
  const key = takeProfitStateKey(opts.symbolKey, opts.leg);
  const state = getOrCreate(key);
  seedFromLegacyCurrent(state, opts.tpCfg);

  const armMin = Math.max(0, opts.armMinimum ?? 0);
  if (opts.unrealizedPNL >= armMin) {
    state.armed = true;
  }

  if (opts.allowPeakUpdate && opts.unrealizedPNL > state.peakUnrealizedPct) {
    state.peakUnrealizedPct = opts.unrealizedPNL;
    state.peakAtMs = Date.now();
  }

  if (opts.tpCfg != null) {
    opts.tpCfg.current = state.peakUnrealizedPct;
  }

  return { ...state };
}

export function resolveTakeProfitLeg(symbolOptions: { takeProfitBuy?: { enabled?: boolean } }, next: string): TakeProfitLeg {
  if (next === "BUY" && symbolOptions.takeProfitBuy?.enabled === true) {
    return "buy";
  }
  return "sell";
}
