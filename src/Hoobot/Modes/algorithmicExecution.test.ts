import type { Candlestick } from "../Exchanges/Candlesticks";
import type { SymbolOptions } from "../Utilities/Args";
import {
  evaluateAlgorithmicTickPolicy,
  evaluateSimAlgorithmicTickPolicy,
  resetAlgorithmicExecutionRuntime,
} from "./algorithmicExecution";

const sym = (): SymbolOptions =>
  ({
    name: "BTC/EUR",
    timeframes: ["3m", "1m"],
    scoutConfirm: { enabled: true, scoutTimeframe: "1m", confirmTimeframe: "3m" },
  }) as SymbolOptions;

const candle = (t: number, isFinal: boolean): Candlestick =>
  ({ time: t, startTime: t, open: 1, high: 1, low: 1, close: 1, volume: 1, isFinal }) as Candlestick;

describe("algorithmicExecution", () => {
  beforeEach(() => resetAlgorithmicExecutionRuntime());

  it("runs on first confirm close", () => {
    const key = "BTC/EUR";
    const cs = {
      [key]: {
        "3m": [candle(1000, true)],
        "1m": [candle(1000, true)],
      },
    };
    const p = evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    expect(p.runFullDecision).toBe(true);
    expect(p.reason).toBe("confirm close");
  });

  it("skips when flat and confirm bar unchanged", () => {
    const key = "BTC/EUR";
    const cs = {
      [key]: {
        "3m": [candle(1000, true)],
        "1m": [candle(1000, true)],
      },
    };
    evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    const p2 = evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    expect(p2.runFullDecision).toBe(false);
    expect(p2.reason).toBe("wait scout/confirm close");
  });

  it("runs on new 1m scout close when flat", () => {
    const key = "BTC/EUR";
    const cs1 = {
      [key]: {
        "3m": [candle(1000, true)],
        "1m": [candle(1000, true)],
      },
    };
    evaluateAlgorithmicTickPolicy(key, sym(), cs1, false);
    const cs2 = {
      [key]: {
        "3m": [candle(1000, true)],
        "1m": [candle(1000, true), candle(1060, true)],
      },
    };
    const p = evaluateAlgorithmicTickPolicy(key, sym(), cs2, false);
    expect(p.runFullDecision).toBe(true);
    expect(p.reason).toBe("scout 1m close");
  });

  it("runs when open position even if bar unchanged", () => {
    const key = "BTC/EUR";
    const cs = { [key]: { "3m": [candle(2000, true)] } };
    evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    const p = evaluateAlgorithmicTickPolicy(key, sym(), cs, true);
    expect(p.runFullDecision).toBe(true);
    expect(p.reason).toBe("open position tp/sl");
  });

  it("treats closed round-trip history as flat for tick policy", () => {
    const key = "BTC/EUR";
    const cs = {
      [key]: {
        "3m": [candle(1000, true)],
        "1m": [candle(1000, true)],
      },
    };
    evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    const p2 = evaluateAlgorithmicTickPolicy(key, sym(), cs, false);
    expect(p2.runFullDecision).toBe(false);
    expect(p2.reason).toBe("wait scout/confirm close");
  });

  it("sim policy tracks primary series closes", () => {
    const key = "BTC/EUR";
    const series = [candle(3000, true)];
    const first = evaluateSimAlgorithmicTickPolicy(key, sym(), series, false);
    expect(first.runFullDecision).toBe(true);
    const second = evaluateSimAlgorithmicTickPolicy(key, sym(), series, false);
    expect(second.runFullDecision).toBe(false);
  });
});
