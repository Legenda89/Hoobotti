import type { SymbolOptions } from "../Utilities/Args";
import {
  resolvePartialCloseFraction,
  resolvePartialTakeProfitBaseQty,
  shouldUsePartialTakeProfitClose,
} from "./partialTakeProfit";
import {
  markTakeProfitPartialTaken,
  resetTakeProfitRuntimeForSymbol,
} from "../Indicators/takeProfitPositionState";
import { shouldBlockCounterTrendEntry, resolveAlgorithmicAdaptiveConfig } from "../Modes/algorithmicAdaptive";
import {
  meanReversionVolatileAlgorithmicIndicators,
  applyRecommendedAlgorithmicIndicators,
} from "../Modes/algorithmicIndicators";

describe("partialTakeProfit", () => {
  const sym = (): SymbolOptions =>
    ({
      name: "BTC/EUR",
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
    resetTakeProfitRuntimeForSymbol("BTCEUR");
  });

  it("uses half base on first TAKE_PROFIT", () => {
    const opts = sym();
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "SELL")).toBe(true);
    const qty = resolvePartialTakeProfitBaseQty(2, opts, "TAKE_PROFIT", "SELL");
    expect(qty).toBeCloseTo(2 * 0.5 * 0.98, 5);
  });

  it("does not partial on STOP_LOSS or after partial taken", () => {
    const opts = sym();
    expect(shouldUsePartialTakeProfitClose(opts, "STOP_LOSS", "SELL")).toBe(false);
    markTakeProfitPartialTaken("BTCEUR", "sell");
    expect(shouldUsePartialTakeProfitClose(opts, "TAKE_PROFIT", "SELL")).toBe(false);
    expect(resolvePartialTakeProfitBaseQty(2, opts, "TAKE_PROFIT", "SELL")).toBeUndefined();
  });

  it("clamps fraction", () => {
    expect(resolvePartialCloseFraction({ fraction: 0.5 })).toBe(0.5);
    expect(resolvePartialCloseFraction({ fraction: 1.5 })).toBe(0.5);
    expect(resolvePartialCloseFraction({ fraction: 0 })).toBe(0.5);
  });
});

describe("shouldBlockCounterTrendEntry", () => {
  const cfg = () => resolveAlgorithmicAdaptiveConfig({ algorithmicAdaptive: { enabled: true } } as SymbolOptions);

  it("blocks buy into short trend and sell into long trend on SKIP entries only", () => {
    expect(shouldBlockCounterTrendEntry("BUY", "SKIP", "SHORT", cfg())).toBe(true);
    expect(shouldBlockCounterTrendEntry("SELL", "SKIP", "LONG", cfg())).toBe(true);
    expect(shouldBlockCounterTrendEntry("BUY", "SKIP", "LONG", cfg())).toBe(false);
    // Mean-reversion exit signals must not be hard-blocked by 4h trend
    expect(shouldBlockCounterTrendEntry("SELL", "SELL", "LONG", cfg())).toBe(false);
    expect(shouldBlockCounterTrendEntry("BUY", "BUY", "SHORT", cfg())).toBe(false);
  });

  it("never blocks TP/SL", () => {
    expect(shouldBlockCounterTrendEntry("SELL", "STOP_LOSS", "LONG", cfg())).toBe(false);
    expect(shouldBlockCounterTrendEntry("SELL", "TAKE_PROFIT", "LONG", cfg())).toBe(false);
  });
});

describe("meanReversionVolatile", () => {
  it("uses wider RSI/BB thresholds", () => {
    const ind = meanReversionVolatileAlgorithmicIndicators();
    expect(ind.rsi?.tresholds?.overbought).toBe(75);
    expect(ind.bb?.multiplier).toBe(2.2);
  });

  it("applies to symbol when preset set", () => {
    const s = { name: "XRP/BRL", indicatorsPreset: "meanReversionVolatile" } as SymbolOptions;
    applyRecommendedAlgorithmicIndicators(s);
    expect(s.indicators?.rsi?.tresholds?.overbought).toBe(75);
    expect(s.indicatorsPreset).toBe("meanReversionVolatile");
  });
});
