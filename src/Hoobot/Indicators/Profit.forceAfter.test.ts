import { applyTakeProfitForceAfter } from "./Profit";

describe("applyTakeProfitForceAfter", () => {
  const baseTp = {
    enabled: true,
    forceAfterEnabled: true,
    forceAfterCandles: 0,
    forceAfterDrop: 0.25,
    forceMinProfit: 0.3,
    limit: 0,
  };

  it("returns TAKE_PROFIT_FORCE from HOLD when drop from peak is large enough", () => {
    const check = applyTakeProfitForceAfter({
      check: "HOLD",
      next: "SELL",
      unrealizedPNL: 0.5,
      peakUnrealizedPct: 1.0,
      candlesSinceLastTrade: 1,
      effectiveTrend: "LONG",
      tpCfg: baseTp,
    });
    expect(check).toBe("TAKE_PROFIT_FORCE");
  });

  it("does nothing when forceAfterEnabled is false", () => {
    const check = applyTakeProfitForceAfter({
      check: "HOLD",
      next: "SELL",
      unrealizedPNL: 0.5,
      peakUnrealizedPct: 1.0,
      candlesSinceLastTrade: 1,
      effectiveTrend: "LONG",
      tpCfg: { ...baseTp, forceAfterEnabled: false },
    });
    expect(check).toBe("HOLD");
  });

  it("upgrades TAKE_PROFIT to TAKE_PROFIT_FORCE", () => {
    const check = applyTakeProfitForceAfter({
      check: "TAKE_PROFIT",
      next: "SELL",
      unrealizedPNL: 0.8,
      peakUnrealizedPct: 1.2,
      candlesSinceLastTrade: 2,
      effectiveTrend: "LONG",
      tpCfg: baseTp,
    });
    expect(check).toBe("TAKE_PROFIT_FORCE");
  });

  it("blocks when unrealized below forceMinProfit", () => {
    const check = applyTakeProfitForceAfter({
      check: "HOLD",
      next: "SELL",
      unrealizedPNL: 0.2,
      peakUnrealizedPct: 0.6,
      candlesSinceLastTrade: 1,
      effectiveTrend: "LONG",
      tpCfg: baseTp,
    });
    expect(check).toBe("HOLD");
  });
});
