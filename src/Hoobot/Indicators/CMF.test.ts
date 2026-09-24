import { calculateCMF, checkCMFSignals } from "./CMF";
import type { Candlestick } from "../Exchanges/Candlesticks";
import type { SymbolOptions } from "../Utilities/Args";

const candle = (close: number, i: number): Candlestick =>
  ({
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + i,
    time: i,
    isFinal: true,
  }) as Candlestick;

describe("checkCMFSignals", () => {
  it("can evaluate crossover when CMF series is shorter than 50", () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(100 + i * 0.1, i));
    const cmfValues = calculateCMF(candles, 20);
    const symbolOptions = {
      name: "BTC/EUR",
      indicators: {
        cmf: {
          enabled: true,
          length: 20,
          history: 3,
          weight: 1,
          tresholds: { overbought: 0.25, oversold: -0.25 },
        },
      },
    } as SymbolOptions;
    const sig = checkCMFSignals(cmfValues, symbolOptions);
    expect(["BUY", "SELL", "HOLD"]).toContain(sig);
  });
});
