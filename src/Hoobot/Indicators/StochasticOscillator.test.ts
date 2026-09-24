import {
  calculateStochasticRSI,
  checkStochasticOscillatorSignals,
  checkStochasticRSISignals,
} from "./StochasticOscillator";
import type { Candlestick } from "../Exchanges/Candlesticks";
import type { SymbolOptions } from "../Utilities/Args";

const soOptions = (): SymbolOptions =>
  ({
    name: "BTC/EUR",
    indicators: {
      so: {
        enabled: true,
        kPeriod: 14,
        dPeriod: 3,
        smoothing: 3,
        tresholds: { overbought: 80, oversold: 20 },
        weight: 1,
      },
      srsi: {
        enabled: true,
        rsiLength: 14,
        stochLength: 14,
        kPeriod: 3,
        dPeriod: 3,
        smoothK: 3,
        smoothD: 3,
        tresholds: { overbought: 80, oversold: 20 },
        weight: 1,
      },
    },
  }) as SymbolOptions;

describe("checkStochasticOscillatorSignals", () => {
  it("returns SELL when K and D are falling above overbought", () => {
    const sig = checkStochasticOscillatorSignals([[83, 80], [82, 81]], soOptions());
    expect(sig).toBe("SELL");
  });

  it("does not SELL on falling K when D is still rising (no crossover)", () => {
    const sig = checkStochasticOscillatorSignals([[80, 78], [80.5, 81]], soOptions());
    expect(sig).toBe("HOLD");
  });
});

describe("checkStochasticRSISignals", () => {
  it("uses falling D for bearish momentum branch", () => {
    const sig = checkStochasticRSISignals([[60, 55], [58, 56]], soOptions());
    expect(sig).not.toBe("BUY");
  });
});

describe("calculateStochasticRSI", () => {
  it("does not corrupt K series when D smoothing window is not full", () => {
    const candles = Array.from({ length: 40 }, (_, i) => ({
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100 + i * 0.1,
      time: i,
      volume: 1000,
      isFinal: true,
    })) as Candlestick[];
    const [kValues, dValues] = calculateStochasticRSI(candles, 14, 14, 3, 3, "EMA", "close");
    expect(kValues.length).toBeGreaterThan(0);
    expect(kValues.every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(dValues.length).toBeLessThanOrEqual(kValues.length);
  });
});
