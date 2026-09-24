import { atrPctFromSeries, effectiveStopLossPnl } from "./stopLossAtr";

describe("stopLossAtr", () => {
  it("computes atr percent from series", () => {
    expect(atrPctFromSeries([1, 2, 4], 100, 3)).toBeCloseTo(4, 5);
  });

  it("widens stop loss when atr scale exceeds base", () => {
    const out = effectiveStopLossPnl(-0.5, 0.8, { atrScale: true, atrMultiplier: 1.5, atrMin: 0.4, atrMax: 2.5 });
    expect(out).toBeCloseTo(-1.2, 5);
  });

  it("does not tighten below user-configured base pnl", () => {
    // Bug: atrMax 3 capped -7% sell SL to ~-3% before fix.
    const out = effectiveStopLossPnl(-7, 1.2, { atrScale: true, atrMultiplier: 2, atrMin: 0.5, atrMax: 3 });
    expect(out).toBe(-7);
  });

  it("keeps buy stop loss base when atr cap would be tighter", () => {
    const out = effectiveStopLossPnl(-3.5, 1.0, { atrScale: true, atrMultiplier: 2, atrMin: 0.5, atrMax: 2 });
    expect(out).toBe(-3.5);
  });

  it("keeps base when atr scale disabled", () => {
    expect(effectiveStopLossPnl(-0.8, 1.2, { atrScale: false })).toBe(-0.8);
  });
});
