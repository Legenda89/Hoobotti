import {
  resolveLiveBuyOrderMode,
  resolveLiveSellOrderMode,
  liveOrderFollowUpDelayMs,
  normalizeLiveOrderExecution,
  isLiveOrderExecutionMode,
  LIVE_ORDER_EXECUTION_MODES,
} from "./liveOrderExecution";
import type { SymbolOptions } from "../Utilities/Args";

const sym = (over?: SymbolOptions["liveOrderExecution"]): SymbolOptions =>
  ({ liveOrderExecution: over } as SymbolOptions);

describe("liveOrderExecution", () => {
  it("uses configured buy market mode", () => {
    expect(resolveLiveBuyOrderMode(sym({ buy: "market" }), "SKIP")).toBe("market");
  });

  it("forces limit for grid", () => {
    expect(resolveLiveBuyOrderMode(sym({ buy: "market" }), "GRID")).toBe("limit");
  });

  it("defaults entry buys to aggressiveLimit without config", () => {
    expect(resolveLiveBuyOrderMode(sym(), "SKIP")).toBe("aggressiveLimit");
  });

  it("defaults stop-loss and stale-exit buys to market", () => {
    expect(resolveLiveBuyOrderMode(sym(), "STOP_LOSS")).toBe("market");
    expect(resolveLiveBuyOrderMode(sym(), "STALE_EXIT")).toBe("market");
    expect(resolveLiveBuyOrderMode(sym({ buy: "limit" }), "STOP_LOSS")).toBe("market");
  });

  it("uses limit for take profit buys", () => {
    expect(resolveLiveBuyOrderMode(sym({ buy: "market" }), "TAKE_PROFIT")).toBe("limit");
  });

  it("respects configured sell mode", () => {
    expect(resolveLiveSellOrderMode(sym({ sell: "market" }), "SELL")).toBe("market");
    expect(resolveLiveSellOrderMode(sym(), "SELL")).toBe("limit");
  });

  it("forces market for stop loss and take profit force sells", () => {
    expect(resolveLiveSellOrderMode(sym({ sell: "limit" }), "STOP_LOSS")).toBe("market");
    expect(resolveLiveSellOrderMode(sym({ sell: "limit" }), "TAKE_PROFIT_FORCE")).toBe("market");
    expect(resolveLiveSellOrderMode(sym({ sell: "limit" }), "TAKE_PROFIT")).toBe("limit");
  });

  it("keeps TAKE_PROFIT as limit even when sell is market", () => {
    expect(resolveLiveSellOrderMode(sym({ sell: "market" }), "TAKE_PROFIT")).toBe("limit");
    expect(resolveLiveSellOrderMode(sym({ sell: "market" }), "STOP_LOSS")).toBe("market");
  });

  it("uses market for STALE_EXIT closes", () => {
    expect(resolveLiveSellOrderMode(sym({ sell: "limit" }), "STALE_EXIT")).toBe("market");
    expect(resolveLiveBuyOrderMode(sym({ buy: "limit" }), "STALE_EXIT")).toBe("market");
  });

  it("shortens follow-up delay for market orders", () => {
    expect(liveOrderFollowUpDelayMs("market")).toBeLessThan(liveOrderFollowUpDelayMs("limit"));
  });

  it("exports all supported modes", () => {
    expect(LIVE_ORDER_EXECUTION_MODES).toEqual(["limit", "aggressiveLimit", "market"]);
    for (const mode of LIVE_ORDER_EXECUTION_MODES) {
      expect(isLiveOrderExecutionMode(mode)).toBe(true);
    }
    expect(isLiveOrderExecutionMode("invalid")).toBe(false);
  });

  it("normalizeLiveOrderExecution strips invalid values", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const out = normalizeLiveOrderExecution("BTC/EUR", { buy: "market", sell: "bad" as "limit" });
    expect(out).toEqual({ buy: "market" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
