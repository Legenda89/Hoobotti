import { buildCandleSeriesFingerprint, getCachedIndicatorCalc, setCachedIndicatorCalc } from "./indicatorCalcCache";
import type { Candlestick } from "../Exchanges/Candlesticks";

describe("indicatorCalcCache", () => {
  it("fingerprint changes when last candle close updates", () => {
    const series: Candlestick[] = [
      { open: 1, high: 1, low: 1, close: 1, time: 1, isFinal: false } as Candlestick,
    ];
    const a = buildCandleSeriesFingerprint(series);
    series[0] = { ...series[0], close: 2 };
    const b = buildCandleSeriesFingerprint(series);
    expect(a).not.toBe(b);
  });

  it("returns cached value for same fingerprint", () => {
    setCachedIndicatorCalc("BTCUSDT", "fp1", { macd: { "3m": {} } });
    expect(getCachedIndicatorCalc("BTCUSDT", "fp1")).toEqual({ macd: { "3m": {} } });
    expect(getCachedIndicatorCalc("BTCUSDT", "fp2")).toBeUndefined();
  });
});
