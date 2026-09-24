import {
  filterCandlesticksBySimulationHistoryYears,
  formatSimulationHistoryPeriodFi,
  SIMULATION_HISTORY_ONE_MONTH_YEARS,
  SIMULATION_HISTORY_SIX_MONTHS_YEARS,
  type Candlestick,
} from "./Candlesticks";

function mkCandle(time: number): Candlestick {
  return {
    symbol: "BTCUSDT",
    interval: "5m",
    type: "k",
    time,
    startTime: time,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    trades: 0,
    volume: 1,
    quoteVolume: 1,
    buyVolume: 0,
    quoteBuyVolume: 0,
    isFinal: true,
  };
}

describe("filterCandlesticksBySimulationHistoryYears", () => {
  it("keeps candles within one month window", () => {
    const now = Date.now();
    const msMonth = SIMULATION_HISTORY_ONE_MONTH_YEARS * 365.25 * 24 * 60 * 60 * 1000;
    const candles = [mkCandle(now - msMonth - 1000), mkCandle(now - msMonth + 1000), mkCandle(now - 1000)];
    const filtered = filterCandlesticksBySimulationHistoryYears(candles, SIMULATION_HISTORY_ONE_MONTH_YEARS);
    expect(filtered).toHaveLength(2);
  });

  it("keeps candles within six month window", () => {
    const now = Date.now();
    const msSix = SIMULATION_HISTORY_SIX_MONTHS_YEARS * 365.25 * 24 * 60 * 60 * 1000;
    const candles = [mkCandle(now - msSix - 1000), mkCandle(now - msSix + 1000)];
    const filtered = filterCandlesticksBySimulationHistoryYears(candles, SIMULATION_HISTORY_SIX_MONTHS_YEARS);
    expect(filtered).toHaveLength(1);
  });
});

describe("formatSimulationHistoryPeriodFi", () => {
  it("labels month and half-year presets", () => {
    expect(formatSimulationHistoryPeriodFi(SIMULATION_HISTORY_ONE_MONTH_YEARS)).toBe("viimeiset 1 kk");
    expect(formatSimulationHistoryPeriodFi(SIMULATION_HISTORY_SIX_MONTHS_YEARS)).toBe("viimeiset 6 kk");
    expect(formatSimulationHistoryPeriodFi(1)).toBe("viimeiset 1 vuosi");
  });
});
