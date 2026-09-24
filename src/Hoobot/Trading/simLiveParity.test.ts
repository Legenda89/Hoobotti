/* =====================================================================
 * Sim ↔ live parity: shared gates used by both execution paths.
 * Live: Algorithmic → buy/sell; Sim: simulateAlgorithmic → simulateBuy/Sell.
 * ===================================================================== */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SymbolOptions } from "../Utilities/Args";
import {
  shouldUsePartialTakeProfitClose,
  resolvePartialTakeProfitBaseQty,
} from "./partialTakeProfit";
import {
  markTakeProfitPartialTaken,
  resetTakeProfitRuntimeForSymbol,
} from "../Indicators/takeProfitPositionState";
import {
  shouldBlockCounterTrendEntry,
  resolveAlgorithmicAdaptiveConfig,
} from "../Modes/algorithmicAdaptive";

const srcRoot = join(process.cwd(), "src", "Hoobot");

describe("sim↔live parity — counter-trend block", () => {
  const cfg = () =>
    resolveAlgorithmicAdaptiveConfig({
      algorithmicAdaptive: { enabled: true, blockCounterTrendEntries: true },
    } as SymbolOptions);

  it("blocks the same entries regardless of live vs sim caller", () => {
    const c = cfg();
    // Same inputs → same decision (used from Algorithmic for both paths)
    expect(shouldBlockCounterTrendEntry("BUY", "SKIP", "SHORT", c)).toBe(true);
    expect(shouldBlockCounterTrendEntry("SELL", "SKIP", "LONG", c)).toBe(true);
    expect(shouldBlockCounterTrendEntry("BUY", "SKIP", "LONG", c)).toBe(false);
    expect(shouldBlockCounterTrendEntry("SELL", "TAKE_PROFIT", "LONG", c)).toBe(false);
  });

  it("respects blockCounterTrendEntries=false", () => {
    const c = resolveAlgorithmicAdaptiveConfig({
      algorithmicAdaptive: { enabled: true, blockCounterTrendEntries: false },
    } as SymbolOptions);
    expect(shouldBlockCounterTrendEntry("BUY", "SKIP", "SHORT", c)).toBe(false);
  });
});

describe("sim↔live parity — partial take profit", () => {
  const sym = (): SymbolOptions =>
    ({
      name: "ETH/EUR",
      takeProfit: {
        enabled: true,
        limit: 0.4,
        minimum: 1,
        drop: 0.18,
        current: 0,
        partialClose: { enabled: true, fraction: 0.5 },
      },
    }) as SymbolOptions;

  beforeEach(() => {
    resetTakeProfitRuntimeForSymbol("ETHEUR");
  });

  it("first TP partial then remainder full — same for sell path", () => {
    const opts = sym();
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "SELL")).toBe(true);
    expect(resolvePartialTakeProfitBaseQty(10, opts, "TAKE_PROFIT", "SELL")).toBeCloseTo(10 * 0.5 * 0.98, 5);
    markTakeProfitPartialTaken("ETHEUR", "sell");
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "SELL")).toBe(false);
    expect(resolvePartialTakeProfitBaseQty(5, opts, "TAKE_PROFIT", "SELL")).toBeUndefined();
  });

  it("BUY leg uses the same gate", () => {
    const opts = {
      ...sym(),
      takeProfitBuy: {
        enabled: true,
        limit: 0.4,
        minimum: 1,
        drop: 0.18,
        current: 0,
        partialClose: { enabled: true, fraction: 0.4 },
      },
    } as SymbolOptions;
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "BUY")).toBe(true);
    markTakeProfitPartialTaken("ETHEUR", "buy");
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "BUY")).toBe(false);
  });
});

describe("sim↔live parity — wiring", () => {
  it("Algorithmic uses shared counter-trend gate for live and sim", () => {
    const algo = readFileSync(join(srcRoot, "Modes", "Algorithmic.ts"), "utf-8");
    expect(algo).toMatch(/shouldBlockCounterTrendEntry/);
    expect(algo).toMatch(/recordCounterTrendBlock/);
    expect(algo).toMatch(/export const simulateAlgorithmic/);
    expect(algo).toMatch(/simulateSell/);
    expect(algo).toMatch(/simulateBuy/);
  });

  it("Trades applies partial TP gate on live and simulate closes", () => {
    const trades = readFileSync(join(srcRoot, "Exchanges", "Trades.ts"), "utf-8");
    expect(trades).toMatch(/shouldUsePartialTakeProfitClose/);
    expect(trades).toMatch(/noteFullTakeProfitClose/);
    expect(trades).toMatch(/noteTakeProfitFillOutcome/);
    const sellIdx = trades.indexOf("export const sell");
    const buyIdx = trades.indexOf("export const buy");
    const simSellIdx = trades.indexOf("export const simulateSell");
    const simBuyIdx = trades.indexOf("export const simulateBuy");
    expect(sellIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(sellIdx);
    expect(simSellIdx).toBeGreaterThan(buyIdx);
    expect(simBuyIdx).toBeGreaterThan(simSellIdx);
    for (const slice of [
      trades.slice(sellIdx, buyIdx),
      trades.slice(buyIdx, simSellIdx),
      trades.slice(simSellIdx, simBuyIdx),
      trades.slice(simBuyIdx, simBuyIdx + 5000),
    ]) {
      expect(slice).toMatch(/shouldUsePartialTakeProfitClose|noteTakeProfitFillOutcome|noteFullTakeProfitClose/);
    }
  });
});
