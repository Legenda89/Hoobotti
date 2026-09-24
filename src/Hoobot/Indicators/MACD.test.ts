import { calculateMACD, checkMACDSignals } from "./MACD";
import type { Candlestick } from "../Exchanges/Candlesticks";

describe("checkMACDSignals", () => {
  const opts = {
    name: "BTC/EUR",
    indicators: { macd: { enabled: true, fast: 12, slow: 26, signal: 9, weight: 1 } },
  } as never;

  const candles = Array.from({ length: 80 }, (_, i) => ({
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100 + i * 0.1,
    time: i,
    isFinal: true,
  })) as Candlestick[];

  it("returns HOLD when macd data missing", () => {
    expect(checkMACDSignals(undefined, opts)).toBe("HOLD");
    expect(
      checkMACDSignals({ macdLine: [], signalLine: [], histogram: [] }, opts)
    ).toBe("HOLD");
  });

  it("calculateMACD returns histogram with enough candles", () => {
    const macd = calculateMACD(candles, 12, 26, 9, "close");
    expect(macd.histogram.length).toBeGreaterThan(1);
  });

  it("returns BUY, SELL, or HOLD from histogram momentum", () => {
    const macd = calculateMACD(candles, 12, 26, 9, "close");
    const sig = checkMACDSignals(macd, opts);
    expect(["BUY", "SELL", "HOLD"]).toContain(sig);
  });
});
