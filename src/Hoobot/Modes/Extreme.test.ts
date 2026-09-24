import type { Candlestick } from "../Exchanges/Candlesticks";
import {
  applyIdleForceSignal,
  computeWaitEaseFactors,
  evaluateExtremeSignal,
  resolveExtremeConfig,
  resolveExtremeThresholds,
  resolveIdleForceCandles,
  trendThresholdMultipliers,
  volatilityMultiplierFromSeries,
} from "./Extreme";
import { quotePnlLong } from "./HiLowFixed";

describe("Extreme", () => {
  const ob = (bid: number, ask: number) => ({
    bids: { [bid.toFixed(2)]: 1 },
    asks: { [ask.toFixed(2)]: 1 },
  });

  it("sells long at adaptive threshold", () => {
    const th = {
      sellProfitQuote: 4,
      buyMoveQuote: 6,
      volMult: 1,
      trendSellMult: 1,
      trendBuyMult: 1,
      waitProgress: 0,
      escapeActive: false,
      idleForceCandles: null,
      candlesSinceLastTrade: 0,
    };
    expect(quotePnlLong(100, 1, 105, 0)).toBeGreaterThanOrEqual(4);
    expect(evaluateExtremeSignal(true, 100, 1, ob(105, 105), 0, th)).toBe("TAKE_PROFIT");
  });

  it("scales thresholds with volatility", () => {
    const volatile = Array.from({ length: 30 }, (_, i) => ({
      isFinal: true,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      time: i,
    })) as Candlestick[];
    const mult = volatilityMultiplierFromSeries(volatile, 24);
    expect(mult).toBeGreaterThan(1);
  });

  it("trend LONG eases sell while long", () => {
    const t = trendThresholdMultipliers("LONG", true);
    expect(t.sellMult).toBeLessThan(1);
  });

  it("forces trade after idle candle limit", () => {
    const cfg = resolveExtremeConfig({ name: "X", extreme: { idleForceDays: 5 } } as never);
    expect(resolveIdleForceCandles(cfg, 5)).toBe(1440);
    const th = {
      sellProfitQuote: 100,
      buyMoveQuote: 100,
      volMult: 1,
      trendSellMult: 1,
      trendBuyMult: 1,
      waitProgress: 0,
      escapeActive: false,
      idleForceCandles: 100,
      candlesSinceLastTrade: 150,
    };
    expect(applyIdleForceSignal("HOLD", th)).toBe("FORCE_IDLE");
  });

  it("tightens thresholds progressively between escape and idle force", () => {
    const cfg = resolveExtremeConfig({
      name: "X",
      extreme: { maxCashCandles: 100, idleForceDays: 5 },
    } as never);
    const idle = resolveIdleForceCandles(cfg, 5)!;
    const atEscape = computeWaitEaseFactors(100, false, cfg.maxLongCandles, cfg.maxCashCandles, idle);
    const mid = computeWaitEaseFactors(100 + Math.floor((idle - 100) / 2), false, cfg.maxLongCandles, cfg.maxCashCandles, idle);
    const nearIdle = computeWaitEaseFactors(idle - 1, false, cfg.maxLongCandles, cfg.maxCashCandles, idle);
    expect(atEscape.buyFactor).toBeCloseTo(0.5, 2);
    expect(mid.buyFactor).toBeLessThan(atEscape.buyFactor);
    expect(nearIdle.buyFactor).toBeLessThanOrEqual(0.1);
    expect(nearIdle.buyFactor).toBeGreaterThan(0);
  });

  it("resolveExtremeThresholds lowers buyMove over wait span", () => {
    const cfg = resolveExtremeConfig({
      name: "BTC/EUR",
      extreme: { sellProfitQuote: 6, buyMoveQuote: 6, maxCashCandles: 288, idleForceDays: 5 },
    } as never);
    const intervalMs = 5 * 60 * 1000;
    const baseTime = 1_700_000_000_000;
    const early = resolveExtremeThresholds(cfg, {
      series: [],
      symbolOptions: { name: "BTC/EUR" } as never,
      lastTradeIsBuyer: false,
      lastTradeTimeMs: baseTime,
      latestCandleTimeMs: baseTime + 280 * intervalMs,
      primaryTf: "5m",
    });
    const late = resolveExtremeThresholds(cfg, {
      series: [],
      symbolOptions: { name: "BTC/EUR" } as never,
      lastTradeIsBuyer: false,
      lastTradeTimeMs: baseTime,
      latestCandleTimeMs: baseTime + 1200 * intervalMs,
      primaryTf: "5m",
    });
    expect(early.escapeActive).toBe(false);
    expect(late.escapeActive).toBe(true);
    expect(late.buyMoveQuote).toBeLessThan(early.buyMoveQuote);
  });

  it("no stop loss when omitted", () => {
    const noSl = resolveExtremeConfig({ name: "X", extreme: {} } as never);
    expect(noSl.stopLossQuote).toBeUndefined();
    const th = resolveExtremeThresholds(noSl, {
      series: [],
      symbolOptions: { name: "BTC/EUR" } as never,
      lastTradeIsBuyer: true,
      lastTradeTimeMs: 0,
      latestCandleTimeMs: 1_000_000,
      primaryTf: "5m",
    });
    expect(th.idleForceCandles).toBe(1440);
    expect(evaluateExtremeSignal(true, 100, 1, ob(90, 90), 0, th)).toBe("HOLD");
  });
});
