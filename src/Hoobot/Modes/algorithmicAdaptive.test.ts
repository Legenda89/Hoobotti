import type { Candlestick } from "../Exchanges/Candlesticks";
import {
  agreementEaseFromWait,
  agreementVolatilityDelta,
  atrVolatilityMultiplier,
  candlesSinceLastTrade,
  detectVoteConflict,
  resolveAlgorithmicAdaptiveConfig,
  resolveEffectiveAgreement,
  trendAgreementDelta,
  withAdaptiveProfitScaling,
} from "./algorithmicAdaptive";

describe("algorithmicAdaptive", () => {
  it("defaults enabled when section missing", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({ name: "X/USDT" } as never);
    expect(cfg.enabled).toBe(true);
    expect(cfg.conflictMinShare).toBe(38);
  });

  it("can disable via enabled false", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({
      name: "X",
      algorithmicAdaptive: { enabled: false },
    } as never);
    expect(cfg.enabled).toBe(false);
  });

  it("detects vote conflict", () => {
    expect(detectVoteConflict({ BUY: 40, SELL: 42 }, 38)).toBe(true);
    expect(detectVoteConflict({ BUY: 50, SELL: 10 }, 38)).toBe(false);
  });

  it("trend lowers agreement for aligned BUY in LONG", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({ name: "X" } as never);
    expect(trendAgreementDelta("BUY", "LONG", cfg)).toBe(-6);
    expect(trendAgreementDelta("BUY", "SHORT", cfg)).toBe(10);
  });

  it("raises agreement threshold in high vol", () => {
    expect(agreementVolatilityDelta(1.2)).toBeGreaterThan(0);
    expect(agreementVolatilityDelta(1)).toBe(0);
  });

  it("eases agreement when stuck in cash", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({
      name: "X",
      algorithmicAdaptive: { maxCashCandles: 100, agreementEaseMax: 10 },
    } as never);
    expect(agreementEaseFromWait(50, "BUY", cfg)).toBe(0);
    expect(agreementEaseFromWait(150, "BUY", cfg)).toBeLessThan(0);
  });

  it("counts wait from simulationSessionStartMs when tradeHistory is empty", () => {
    const waited = candlesSinceLastTrade(
      { name: "BTC/EUR", timeframes: ["3m"] } as never,
      1_000_000 + 288 * 180_000,
      {
        tradeHistory: {},
        simulationSessionStartMs: 1_000_000,
      } as never
    );
    expect(waited).toBe(288);
    expect(
      candlesSinceLastTrade(
        { name: "BTC/EUR", timeframes: ["3m"] } as never,
        1_000_000 + 1000,
        { tradeHistory: {} } as never
      )
    ).toBe(0);
  });

  it("applies ease in resolveEffectiveAgreement before first trade (sim session)", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({
      name: "X",
      algorithmicAdaptive: { maxCashCandles: 100, agreementEaseMax: 10, conflictEnabled: false },
    } as never);
    const start = 1_000_000;
    const r = resolveEffectiveAgreement({
      baseAgreement: 70,
      volMult: 1,
      cfg,
      next: "BUY",
      trend: "LONG",
      directions: { BUY: 60, SELL: 10 },
      closeTime: start + 150 * 180_000,
      symbolOptions: { name: "BTC/EUR", agreement: 70, timeframes: ["3m"] } as never,
      exchangeOptions: { tradeHistory: {}, simulationSessionStartMs: start } as never,
    });
    expect(r.ease).toBeLessThan(0);
    expect(r.effective).toBeLessThan(70);
  });

  it("scales takeProfit minimum with volMult", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({ name: "X" } as never);
    const scaled = withAdaptiveProfitScaling(
      {
        name: "X/USDT",
        tradeFeePercentage: 0.1,
        takeProfit: { enabled: true, minimum: 2, drop: 0.5, limit: 0.1, current: 0 },
      } as never,
      1.2,
      cfg
    );
    expect(scaled.takeProfit?.minimum).toBeGreaterThan(2);
    expect(scaled.takeProfit?.drop).toBeGreaterThan(0.5);
  });

  it("ATR ratio increases multiplier on wider ranges", () => {
    const low = atrVolatilityMultiplier([0.1, 0.1, 0.1], 100, 48);
    const high = atrVolatilityMultiplier([0.1, 0.1, 0.5], 100, 48);
    expect(high).toBeGreaterThan(low);
  });

  it("resolveEffectiveAgreement clamps and applies conflict penalty", () => {
    const cfg = resolveAlgorithmicAdaptiveConfig({ name: "X" } as never);
    const r = resolveEffectiveAgreement({
      baseAgreement: 75,
      volMult: 1.25,
      cfg,
      next: "BUY",
      trend: "SHORT",
      directions: { BUY: 45, SELL: 45 },
      closeTime: 1_000_000,
      symbolOptions: { name: "X/USDT", agreement: 75, timeframes: ["5m"] } as never,
      exchangeOptions: { tradeHistory: {} } as never,
    });
    expect(r.conflict).toBe(true);
    expect(r.effective).toBeGreaterThan(75);
  });
});
