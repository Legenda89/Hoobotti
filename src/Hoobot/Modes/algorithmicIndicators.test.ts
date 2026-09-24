import type { SymbolOptions } from "../Utilities/Args";
import {
  applyIndicatorParadigm,
  applyRecommendedAlgorithmicIndicators,
  meanReversionAlgorithmicIndicators,
  momentumAlgorithmicIndicators,
  recommendedAlgorithmicIndicators,
  resolveIndicatorsPreset,
  scoutIndicatorsForPreset,
  shouldApplyComplementaryIndicators,
} from "./algorithmicIndicators";

describe("algorithmicIndicators paradigms", () => {
  it("meanReversion enables RSI/BB/CMF and disables MACD/ADX", () => {
    const r = meanReversionAlgorithmicIndicators();
    expect(r.rsi?.enabled).toBe(true);
    expect(r.bb?.enabled).toBe(true);
    expect(r.cmf?.enabled).toBe(true);
    expect(r.macd?.enabled).toBe(false);
    expect(r.adx?.enabled).toBe(false);
  });

  it("momentum enables MACD/ADX/CMF and disables RSI/BB", () => {
    const r = momentumAlgorithmicIndicators();
    expect(r.macd?.enabled).toBe(true);
    expect(r.adx?.enabled).toBe(true);
    expect(r.rsi?.enabled).toBe(false);
    expect(r.bb?.enabled).toBe(false);
  });

  it("applies meanReversion and aligns scout indicators", () => {
    const sym = {
      name: "X/USDT",
      indicatorsPreset: "meanReversion",
      scoutConfirm: { enabled: true, scoutIndicators: ["macd"] },
      indicators: {
        macd: { enabled: true, fast: 5, slow: 15, signal: 6, weight: 1 },
      },
    } as SymbolOptions;
    applyRecommendedAlgorithmicIndicators(sym);
    expect(sym.indicators?.rsi?.enabled).toBe(true);
    expect(sym.indicators?.macd?.enabled).toBe(false);
    expect(sym.scoutConfirm?.scoutIndicators).toEqual(["rsi", "bb"]);
  });

  it("applyIndicatorParadigm momentum sets macd scout", () => {
    const sym = { name: "X/USDT" } as SymbolOptions;
    applyIndicatorParadigm(sym, "momentum");
    expect(sym.indicatorsPreset).toBe("momentum");
    expect(scoutIndicatorsForPreset("momentum")).toEqual(["macd"]);
    expect(sym.scoutConfirm?.scoutIndicators).toEqual(["macd"]);
  });

  it("skips apply when custom preset", () => {
    expect(shouldApplyComplementaryIndicators({ indicatorsPreset: "custom" } as SymbolOptions)).toBe(false);
    expect(resolveIndicatorsPreset({} as SymbolOptions)).toBe("meanReversion");
  });

  it("legacy complementary still has five voting indicators", () => {
    const r = recommendedAlgorithmicIndicators();
    for (const k of ["macd", "rsi", "adx", "bb", "cmf"] as const) {
      expect(r[k]?.enabled).toBe(true);
    }
  });
});
