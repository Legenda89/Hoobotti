import type { Candlestick } from "../Exchanges/Candlesticks";
import type { SymbolOptions } from "../Utilities/Args";
import { consoleLogger as createConsoleLogger } from "../Utilities/ConsoleLogger";
import * as BollingerBands from "../Indicators/BollingerBands";
import * as MACD from "../Indicators/MACD";
import * as RSI from "../Indicators/RSI";
import type { Indicators } from "./Algorithmic";
import {
  computeWeightedDirections,
  getLastCompletedCandle,
  normalizeScoutConfirmTimeframes,
  resetScoutConfirmRuntime,
  resolveScoutConfirmConfig,
  resolveScoutConfirmEntryDirection,
} from "./scoutConfirm";

const log = createConsoleLogger();

const sym = (over: Partial<SymbolOptions> = {}): SymbolOptions =>
  ({
    name: "BTC/EUR",
    agreement: 62,
    timeframes: ["3m", "1m"],
    indicators: {
      rsi: { enabled: true, length: 14, weight: 50, tresholds: { overbought: 70, oversold: 30 } },
      bb: { enabled: true, length: 20, stdDev: 2, weight: 50 },
      macd: { enabled: true, weight: 100, fast: 12, slow: 26, signal: 9 },
    },
    scoutConfirm: {
      enabled: true,
      scoutTimeframe: "1m",
      confirmTimeframe: "3m",
      scoutMinShare: 40,
      scoutIndicators: ["rsi", "bb"],
    },
    ...over,
  }) as SymbolOptions;

const candle = (t: number, isFinal: boolean): Candlestick =>
  ({
    time: t,
    startTime: t,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    isFinal,
  }) as Candlestick;

const emptyIndicators = (): Indicators =>
  ({
    rsi: { "1m": [25], "3m": [25] },
    bollingerBands: { "1m": [[100], [101], [99]], "3m": [[100], [101], [99]] },
    macd: {
      "1m": { histogram: [0, 1], macdLine: [0, 1], signalLine: [0, 1] },
      "3m": { histogram: [0, 1], macdLine: [0, 1], signalLine: [0, 1] },
    },
    sma: { "1m": [], "3m": [] },
    ema: { "1m": {}, "3m": {} },
    adx: { "1m": {}, "3m": {} },
    stochasticOscillator: { "1m": [[], []], "3m": [[], []] },
    stochasticRSI: { "1m": [[], []], "3m": [[], []] },
    obv: { "1m": [], "3m": [] },
    cmf: { "1m": [], "3m": [] },
    renko: { "1m": [], "3m": [] },
    dmi: { "1m": {}, "3m": {} },
  }) as unknown as Indicators;

describe("scoutConfirm", () => {
  beforeEach(() => {
    resetScoutConfirmRuntime();
    jest.restoreAllMocks();
  });

  it("resolves defaults when section missing", () => {
    const cfg = resolveScoutConfirmConfig({ name: "X" } as never);
    expect(cfg.enabled).toBe(false);
    expect(cfg.scoutMinShare).toBe(40);
  });

  it("getLastCompletedCandle prefers final last bar", () => {
    expect(getLastCompletedCandle([candle(1, true)])?.time).toBe(1);
    expect(getLastCompletedCandle([candle(1, true), candle(2, false)])?.time).toBe(1);
    expect(getLastCompletedCandle([candle(1, false)])?.time).toBeUndefined();
    expect(getLastCompletedCandle([candle(1, false), candle(2, true)])?.time).toBe(2);
  });

  it("normalizeScoutConfirmTimeframes puts confirm first", () => {
    const s = sym({ timeframes: ["1m"] });
    normalizeScoutConfirmTimeframes(s);
    expect(s.timeframes?.[0]).toBe("3m");
    expect(s.timeframes).toContain("1m");
  });

  it("computeWeightedDirections aggregates BUY share", () => {
    const dirs = computeWeightedDirections(
      { RSI: "BUY", BollingerBands: "BUY" },
      sym(),
      1
    );
    expect(dirs.BUY).toBe(100);
    expect(dirs.SELL).toBe(0);
  });

  it("blocks entry when scout vote does not match next", () => {
    jest.spyOn(RSI, "checkRSISignals").mockReturnValue("HOLD");
    jest.spyOn(BollingerBands, "checkBollingerBandsSignals").mockReturnValue("HOLD");
    jest.spyOn(MACD, "checkMACDSignals").mockReturnValue("HOLD");

    const symbolKey = "BTC/EUR";
    const result = resolveScoutConfirmEntryDirection({
      consoleLogger: log,
      symbol: "BTC/EUR",
      symbolKey,
      candlesticks: {
        [symbolKey]: { "1m": [candle(1000, true)], "3m": [candle(1000, true)] },
      },
      indicators: emptyIndicators(),
      symbolOptions: sym(),
      exchangeOptions: { tradeHistory: {} } as never,
      scoutCfg: resolveScoutConfirmConfig(sym()),
      next: "BUY",
      trend: "LONG",
      volMult: 1,
      adaptiveCfg: { enabled: false } as never,
      closeTime: 1000,
      profit: "SKIP",
    });

    expect(result.scoutVote).toBe("HOLD");
    expect(result.direction).toBe("HOLD");
  });

  it("allows profit override without scout alignment", () => {
    jest.spyOn(RSI, "checkRSISignals").mockReturnValue("SELL");
    jest.spyOn(BollingerBands, "checkBollingerBandsSignals").mockReturnValue("SELL");
    jest.spyOn(MACD, "checkMACDSignals").mockReturnValue("SELL");

    const symbolKey = "BTC/EUR";
    const result = resolveScoutConfirmEntryDirection({
      consoleLogger: log,
      symbol: "BTC/EUR",
      symbolKey,
      candlesticks: {
        [symbolKey]: { "1m": [candle(2000, true)], "3m": [candle(2000, true)] },
      },
      indicators: emptyIndicators(),
      symbolOptions: sym(),
      exchangeOptions: { tradeHistory: {} } as never,
      scoutCfg: resolveScoutConfirmConfig(sym()),
      next: "BUY",
      trend: "LONG",
      volMult: 1,
      adaptiveCfg: { enabled: false } as never,
      closeTime: 2000,
      profit: "TAKE_PROFIT",
    });

    expect(result.direction).toBe("BUY");
  });

  it("enters when scout locks BUY and confirm agrees", () => {
    jest.spyOn(RSI, "checkRSISignals").mockReturnValue("BUY");
    jest.spyOn(BollingerBands, "checkBollingerBandsSignals").mockReturnValue("BUY");
    jest.spyOn(MACD, "checkMACDSignals").mockReturnValue("BUY");

    const symbolKey = "BTC/EUR";
    const result = resolveScoutConfirmEntryDirection({
      consoleLogger: log,
      symbol: "BTC/EUR",
      symbolKey,
      candlesticks: {
        [symbolKey]: { "1m": [candle(3000, true)], "3m": [candle(3000, true)] },
      },
      indicators: emptyIndicators(),
      symbolOptions: sym(),
      exchangeOptions: { tradeHistory: {} } as never,
      scoutCfg: resolveScoutConfirmConfig(sym()),
      next: "BUY",
      trend: "LONG",
      volMult: 1,
      adaptiveCfg: { enabled: false } as never,
      closeTime: 3000,
      profit: "SKIP",
    });

    expect(result.scoutVote).toBe("BUY");
    expect(result.direction).toBe("BUY");
  });

  it("keeps scout vote stable for same closed 1m bar", () => {
    let rsiCalls = 0;
    jest.spyOn(RSI, "checkRSISignals").mockImplementation(() => {
      rsiCalls += 1;
      return "BUY";
    });
    jest.spyOn(BollingerBands, "checkBollingerBandsSignals").mockReturnValue("BUY");
    jest.spyOn(MACD, "checkMACDSignals").mockReturnValue("HOLD");

    const symbolKey = "BTC/EUR";
    const candlesticks = {
      [symbolKey]: { "1m": [candle(4000, true)], "3m": [candle(4000, true)] },
    };
    const base = {
      consoleLogger: log,
      symbol: "BTC/EUR",
      symbolKey,
      candlesticks,
      indicators: emptyIndicators(),
      symbolOptions: sym(),
      exchangeOptions: { tradeHistory: {} } as never,
      scoutCfg: resolveScoutConfirmConfig(sym()),
      next: "BUY" as const,
      trend: "LONG",
      volMult: 1,
      adaptiveCfg: { enabled: false } as never,
      closeTime: 4000,
      profit: "SKIP",
    };

    const first = resolveScoutConfirmEntryDirection(base);
    const second = resolveScoutConfirmEntryDirection(base);
    expect(first.scoutVote).toBe("BUY");
    expect(second.scoutVote).toBe("BUY");
    expect(first.scoutClosedStart).toBe(4000);
    expect(second.scoutClosedStart).toBe(4000);
    expect(rsiCalls).toBeGreaterThanOrEqual(2);
  });

  it("normalizes 3m scout and 5m confirm timeframes to front of list", () => {
    const s = sym({
      timeframes: ["1m", "3m"],
      scoutConfirm: {
        enabled: true,
        scoutTimeframe: "3m",
        confirmTimeframe: "5m",
        scoutMinShare: 40,
        scoutIndicators: ["rsi"],
      },
    });
    normalizeScoutConfirmTimeframes(s);
    expect(s.timeframes?.[0]).toBe("5m");
    expect(s.timeframes?.[1]).toBe("3m");
    expect(s.timeframes).toContain("1m");
  });
});
