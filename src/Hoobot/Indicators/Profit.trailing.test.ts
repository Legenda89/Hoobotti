import { evaluateTakeProfitTrailing } from "./Profit";
import type { TakeProfitRuntimeState } from "./takeProfitPositionState";

describe("evaluateTakeProfitTrailing", () => {
  const runtime = (peak: number, armed: boolean): TakeProfitRuntimeState => ({
    peakUnrealizedPct: peak,
    peakAtMs: 0,
    armed,
  });

  it("requires armed, drop, positive unrealized, and limit floor", () => {
    expect(
      evaluateTakeProfitTrailing(1.2, { enabled: true, minimum: 1, drop: 0.2, limit: 0.5 }, runtime(2, true))
    ).toBe(true);
  });

  it("fails when not armed", () => {
    expect(
      evaluateTakeProfitTrailing(1.5, { enabled: true, minimum: 2, drop: 0.2, limit: 0 }, runtime(2, false))
    ).toBe(false);
  });

  it("fails when below limit floor", () => {
    expect(
      evaluateTakeProfitTrailing(0.2, { enabled: true, minimum: 0.1, drop: 0.1, limit: 0.5 }, runtime(1, true))
    ).toBe(false);
  });
});
