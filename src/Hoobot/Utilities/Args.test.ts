/* Unit tests for Args (validateOptions, getSecondsFromInterval, getMinutesFromInterval). */

import {
  validateOptions,
  getSecondsFromInterval,
  getMinutesFromInterval,
  preserveExchangeCredentialsFromLive,
  stripExchangeCredentialsForSimulatePersist,
  type ConfigOptions,
  type CandlestickInterval,
  type ExchangeOptions,
} from "./Args";

describe("validateOptions", () => {
  it("returns default config when options is null", () => {
    const result = validateOptions(null as unknown as ConfigOptions);
    expect(result).toEqual({
      running: false,
      debug: false,
      startTime: "",
      exchanges: [],
      license: "",
      simulate: false,
      discord: {},
    });
  });

  it("returns default config when options is not an object", () => {
    const result = validateOptions(undefined as unknown as ConfigOptions);
    expect(result.exchanges).toEqual([]);
  });

  it("ensures exchanges is an array", () => {
    const result = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      exchanges: null as unknown as ConfigOptions["exchanges"],
      license: "",
      simulate: false,
      discord: {},
    });
    expect(Array.isArray(result.exchanges)).toBe(true);
    expect(result.exchanges).toHaveLength(0);
  });

  it("normalizes exchange name and mode", () => {
    const result = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: false,
      discord: {},
      exchanges: [
        { name: undefined, mode: undefined, symbols: [] } as unknown as ConfigOptions["exchanges"][0],
      ],
    });
    expect(result.exchanges[0].name).toBe("");
    expect(result.exchanges[0].mode).toBe("algorithmic");
  });

  it("ensures symbols is array for algorithmic mode", () => {
    const result = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: false,
      discord: {},
      exchanges: [
        {
          name: "binance",
          mode: "algorithmic",
          symbols: undefined,
        } as unknown as ConfigOptions["exchanges"][0],
      ],
    });
    expect(Array.isArray(result.exchanges[0].symbols)).toBe(true);
  });

  it("normalizes invalid liveOrderExecution and warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: false,
      discord: {},
      exchanges: [
        {
          name: "binance",
          mode: "algorithmic",
          symbols: [
            {
              name: "BTC/EUR",
              timeframes: ["3m"],
              liveOrderExecution: { buy: "market", sell: "nope" as "limit" },
            },
          ],
        } as unknown as ConfigOptions["exchanges"][0],
      ],
    });
    expect(result.exchanges[0].symbols[0].liveOrderExecution).toEqual({ buy: "market" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when liveOrderExecution set in simulation", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: true,
      discord: {},
      exchanges: [
        {
          name: "binance",
          mode: "algorithmic",
          symbols: [
            {
              name: "BTC/EUR",
              timeframes: ["3m"],
              liveOrderExecution: { buy: "market" },
            },
          ],
        } as unknown as ConfigOptions["exchanges"][0],
      ],
    });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("ignored in simulation"))).toBe(true);
    warn.mockRestore();
  });
});

describe("getSecondsFromInterval", () => {
  it("returns correct seconds for 1m", () => {
    expect(getSecondsFromInterval("1m" as CandlestickInterval)).toBe(60);
  });
  it("returns correct seconds for 1h", () => {
    expect(getSecondsFromInterval("1h" as CandlestickInterval)).toBe(3600);
  });
  it("returns correct seconds for 1d", () => {
    expect(getSecondsFromInterval("1d" as CandlestickInterval)).toBe(86400);
  });
});

describe("getMinutesFromInterval", () => {
  it("returns correct minutes for 1m", () => {
    expect(getMinutesFromInterval("1m" as CandlestickInterval)).toBe(1);
  });
  it("returns correct minutes for 1h", () => {
    expect(getMinutesFromInterval("1h" as CandlestickInterval)).toBe(60);
  });
});

describe("simulate credentials", () => {
  it("resolves masked simulate keys from live exchanges", () => {
    const incoming = [{ name: "binance", key: "***", secret: "***", symbols: [] }] as unknown as ExchangeOptions[];
    const live = [{ name: "binance", key: "live-key", secret: "live-secret", symbols: [] }] as unknown as ExchangeOptions[];
    const out = preserveExchangeCredentialsFromLive(incoming, live);
    expect(out[0]?.key).toBe("live-key");
    expect(out[0]?.secret).toBe("live-secret");
  });

  it("strips exchange credentials before simulate settings persist", () => {
    const cfg = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: true,
      discord: {},
      exchanges: [{ name: "binance", key: "k", secret: "s", symbols: [] } as unknown as ExchangeOptions],
    });
    const out = stripExchangeCredentialsForSimulatePersist(cfg);
    expect(out.exchanges[0]?.key).toBe("");
    expect(out.exchanges[0]?.secret).toBe("");
  });

  it("disables voting indicators enabled with weight <= 0", () => {
    const cfg = validateOptions({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: false,
      discord: {},
      exchanges: [
        {
          name: "binance",
          mode: "algorithmic",
          symbols: [
            {
              name: "BTC/EUR",
              timeframes: ["3m"],
              indicatorsPreset: "custom",
              indicators: {
                cmf: { enabled: true, length: 20, history: 1, tresholds: { overbought: 0.1, oversold: -0.1 }, weight: 0 },
                rsi: { enabled: true, length: 14, weight: 1.2, tresholds: { overbought: 70, oversold: 30 } },
                atr: { enabled: true, length: 14, weight: 0 },
              },
            },
          ],
        } as unknown as ExchangeOptions,
      ],
    });
    const ind = cfg.exchanges[0]?.symbols?.[0]?.indicators;
    expect(ind?.cmf?.enabled).toBe(false);
    expect(ind?.rsi?.enabled).toBe(true);
    // ATR is not a voting indicator — left enabled with weight 0
    expect(ind?.atr?.enabled).toBe(true);
  });
});
