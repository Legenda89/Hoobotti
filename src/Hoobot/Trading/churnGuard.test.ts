import type { SymbolOptions } from "../Utilities/Args";
import {
  getTradeRateStatus,
  recordEntryForRateLimit,
  recordTradeFillForRateLimit,
  resetTradeRateLimit,
  shouldBlockTradeRateLimitEntry,
} from "./churnGuard";
import { isSymbolCandleStale, markSymbolCandleSubscribed, resetBotHealth } from "../Utilities/botHealth";
import { mayExecuteAlgorithmicTrade } from "./tradeGates";

const rateOpts = (overrides?: Partial<NonNullable<SymbolOptions["tradeRateLimit"]>>): SymbolOptions =>
  ({
    name: "BTC/EUR",
    tradeRateLimit: {
      enabled: true,
      maxTradesPerDay: 3,
      minMinutesBetweenEntries: 30,
      ...overrides,
    },
  }) as SymbolOptions;

describe("churnGuard", () => {
  beforeEach(() => {
    resetTradeRateLimit("TESTCHURN");
  });

  afterAll(() => {
    resetTradeRateLimit("TESTCHURN");
  });

  it("blocks when daily trade count is reached", () => {
    const opts = rateOpts({ maxTradesPerDay: 2, minMinutesBetweenEntries: 0 });
    recordTradeFillForRateLimit("TESTCHURN");
    recordTradeFillForRateLimit("TESTCHURN");
    expect(getTradeRateStatus("TESTCHURN", opts).active).toBe(true);
    expect(getTradeRateStatus("TESTCHURN", opts).reason).toBe("maxTradesPerDay");
    expect(shouldBlockTradeRateLimitEntry("TESTCHURN", opts, "BUY", "SKIP")).toBe(true);
    expect(shouldBlockTradeRateLimitEntry("TESTCHURN", opts, "BUY", "STOP_LOSS")).toBe(false);
  });

  it("blocks when entry spacing is too short", () => {
    const opts = rateOpts({ maxTradesPerDay: 50, minMinutesBetweenEntries: 30 });
    recordEntryForRateLimit("TESTCHURN");
    const status = getTradeRateStatus("TESTCHURN", opts);
    expect(status.active).toBe(true);
    expect(status.reason).toBe("minMinutesBetweenEntries");
    expect(shouldBlockTradeRateLimitEntry("TESTCHURN", opts, "SELL", "SKIP")).toBe(true);
    expect(shouldBlockTradeRateLimitEntry("TESTCHURN", opts, "SELL", "SELL")).toBe(false);
  });

  it("does not block when disabled", () => {
    const opts = rateOpts({ enabled: false, maxTradesPerDay: 1 });
    recordTradeFillForRateLimit("TESTCHURN");
    expect(shouldBlockTradeRateLimitEntry("TESTCHURN", opts, "BUY", "BUY")).toBe(false);
  });
});

describe("stale candles gate", () => {
  beforeEach(() => {
    resetBotHealth();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetBotHealth();
  });

  it("blocks algorithmic entries when candles are stale, allows SL/TP", () => {
    const opts = { name: "ETH/USDC" } as SymbolOptions;
    markSymbolCandleSubscribed("ETH/USDC", ["5m"]);
    jest.advanceTimersByTime(91_000);
    expect(isSymbolCandleStale("ETHUSDC")).toBe(true);

    expect(
      mayExecuteAlgorithmicTrade("BUY", "BUY", {
        hasTradeHistory: true,
        symbolKey: "ETHUSDC",
        symbolOptions: opts,
        blockStaleCandles: true,
      })
    ).toBe(false);

    expect(
      mayExecuteAlgorithmicTrade("STOP_LOSS", "BUY", {
        hasTradeHistory: true,
        symbolKey: "ETHUSDC",
        symbolOptions: opts,
        blockStaleCandles: true,
      })
    ).toBe(true);

    expect(
      mayExecuteAlgorithmicTrade("STALE_EXIT", "SELL", {
        hasTradeHistory: true,
        symbolKey: "ETHUSDC",
        symbolOptions: opts,
        blockStaleCandles: true,
      })
    ).toBe(true);
  });
});
