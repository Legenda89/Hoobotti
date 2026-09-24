import { checkEMASignals, checkTrendSignal } from "./EMA";
import type { SymbolOptions } from "../Utilities/Args";

const symbolOptions = (enabled = true): SymbolOptions =>
  ({
    name: "BTC/EUR",
    indicators: {
      ema: { enabled, short: 9, long: 21, weight: 1 },
    },
  }) as SymbolOptions;

describe("checkEMASignals", () => {
  it("returns BUY on bullish crossover without requiring both EMAs to rise", () => {
    const sig = checkEMASignals(
      {
        short: [10, 11, 12],
        long: [11, 11.5, 11.4],
      },
      symbolOptions()
    );
    expect(sig).toBe("BUY");
  });

  it("does not overwrite crossover with HOLD when only short EMA rises", () => {
    const sig = checkEMASignals(
      {
        short: [10, 10.5, 11],
        long: [10.2, 10.3, 10.35],
      },
      symbolOptions()
    );
    expect(sig).toBe("BUY");
  });
});

describe("checkTrendSignal", () => {
  it("returns LONG default when EMA history is too short", () => {
    expect(checkTrendSignal({ short: [10], long: [9] })).toBe("LONG");
  });
});
