import { checkADXSignals } from "./ADX";
import type { SymbolOptions } from "../Utilities/Args";

const symbolOptions: SymbolOptions = {
  name: "BTC/EUR",
  indicators: {
    adx: { enabled: true, weight: 1, dilength: 14, adxSmoothing: 14 },
  },
} as SymbolOptions;

describe("checkADXSignals", () => {
  it("returns BUY on bullish DI crossover when ADX is strong", () => {
    const sig = checkADXSignals(
      {
        adx: [28, 30],
        plusDI: [12, 28],
        minusDI: [22, 12],
      },
      symbolOptions
    );
    expect(sig).toBe("BUY");
  });

  it("returns SELL on bearish DI crossover when ADX is strong", () => {
    const sig = checkADXSignals(
      {
        adx: [24, 26],
        plusDI: [22, 10],
        minusDI: [10, 22],
      },
      symbolOptions
    );
    expect(sig).toBe("SELL");
  });

  it("returns HOLD without DI crossover even when one side dominates", () => {
    const sig = checkADXSignals(
      {
        adx: [30],
        plusDI: [28],
        minusDI: [12],
      },
      symbolOptions
    );
    expect(sig).toBe("HOLD");
  });
});
