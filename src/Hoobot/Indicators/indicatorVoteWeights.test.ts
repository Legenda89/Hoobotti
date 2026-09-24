import { restoreIndicatorWeights, snapshotIndicatorWeights } from "./indicatorVoteWeights";
import type { SymbolOptions } from "../Utilities/Args";

describe("indicatorVoteWeights", () => {
  it("restores base weights after signal boost mutation", () => {
    const indicators = {
      ema: { enabled: true, short: 9, long: 21, weight: 1 },
      macd: { enabled: true, weight: 2 },
    };
    const snap = snapshotIndicatorWeights(indicators as SymbolOptions["indicators"]);
    indicators.ema!.weight = 1.1;
    indicators.macd!.weight = 5;
    restoreIndicatorWeights(indicators as SymbolOptions["indicators"], snap);
    expect(indicators.ema!.weight).toBe(1);
    expect(indicators.macd!.weight).toBe(2);
  });
});
