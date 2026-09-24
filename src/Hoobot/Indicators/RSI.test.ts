import { checkRSISignals } from "./RSI";
import type { SymbolOptions } from "../Utilities/Args";

const symbolOptions = (history = 3): SymbolOptions =>
  ({
    name: "BTC/EUR",
    indicators: {
      rsi: {
        enabled: true,
        length: 14,
        history,
        tresholds: { overbought: 70, oversold: 30 },
        weight: 1,
      },
    },
  }) as SymbolOptions;

describe("checkRSISignals", () => {
  it("uses latest RSI only, not older bars in history window", () => {
    const sig = checkRSISignals([72, 68, 55], symbolOptions(3));
    expect(sig).toBe("HOLD");
  });

  it("returns SELL when current RSI is overbought", () => {
    expect(checkRSISignals([55, 62, 71], symbolOptions())).toBe("SELL");
  });

  it("returns BUY when current RSI is oversold", () => {
    expect(checkRSISignals([40, 28, 25], symbolOptions())).toBe("BUY");
  });
});
