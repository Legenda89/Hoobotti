import {
  applyFeeAdjustmentToPnl,
  commissionPctPointsFromTrade,
  feePctPointsToSubtractFromPnl,
  liveEntryBuyPriceAcceptable,
  mayExecuteAlgorithmicTrade,
  roundTripPnlAfterFees,
  simFeeRatePerLeg,
} from "./tradeGates";
import { registerStopLossClose, resetConsecutiveLossGuard } from "./consecutiveLossGuard";
import { recordTradeFillForRateLimit, resetTradeRateLimit } from "./churnGuard";
import type { SymbolOptions } from "../Utilities/Args";

const symOpts = (): SymbolOptions =>
  ({
    name: "BTC/EUR",
    blockConsecutiveLoss: { enabled: true, skipEntries: 1, cooldownMinutes: 0, cooldownAfterStopLossMinutes: 20 },
  }) as SymbolOptions;

describe("mayExecuteAlgorithmicTrade", () => {
  it("allows SELL path only for explicit sell signals when position exists", () => {
    expect(mayExecuteAlgorithmicTrade("SELL", "SELL", { hasTradeHistory: true })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("TAKE_PROFIT", "SELL", { hasTradeHistory: true })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("TAKE_PROFIT_FORCE", "SELL", { hasTradeHistory: true })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("STOP_LOSS", "SELL", { hasTradeHistory: true })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("HOLD", "SELL", { hasTradeHistory: true })).toBe(false);
    expect(mayExecuteAlgorithmicTrade("SKIP", "SELL", { hasTradeHistory: true })).toBe(false);
  });

  it("allows SKIP for first entry when no trade history", () => {
    expect(mayExecuteAlgorithmicTrade("SKIP", "BUY", { hasTradeHistory: false })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("SKIP", "SELL", { hasTradeHistory: false })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("SKIP", "BUY", { hasTradeHistory: true })).toBe(false);
  });

  it("allows BUY path only for explicit buy signals when position exists", () => {
    expect(mayExecuteAlgorithmicTrade("BUY", "BUY", { hasTradeHistory: true })).toBe(true);
    expect(mayExecuteAlgorithmicTrade("HOLD", "BUY", { hasTradeHistory: true })).toBe(false);
  });

  it("blocks new entries during stop-loss cooldown", () => {
    resetConsecutiveLossGuard("BTCEUR");
    const opts = symOpts();
    registerStopLossClose("BTCEUR", opts);
    expect(
      mayExecuteAlgorithmicTrade("SKIP", "BUY", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions: opts,
      })
    ).toBe(false);
    expect(
      mayExecuteAlgorithmicTrade("TAKE_PROFIT", "BUY", {
        hasTradeHistory: true,
        hasOpenPosition: false,
        symbolKey: "BTCEUR",
        symbolOptions: opts,
      })
    ).toBe(false);
    expect(
      mayExecuteAlgorithmicTrade("TAKE_PROFIT", "SELL", {
        hasTradeHistory: true,
        hasOpenPosition: true,
        symbolKey: "BTCEUR",
        symbolOptions: opts,
      })
    ).toBe(true);
    expect(
      mayExecuteAlgorithmicTrade("STOP_LOSS", "BUY", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions: opts,
      })
    ).toBe(true);
  });

  it("blocks entries when trade rate limit is active", () => {
    resetTradeRateLimit("RATEBTC");
    const opts = {
      name: "BTC/EUR",
      tradeRateLimit: { enabled: true, maxTradesPerDay: 1, minMinutesBetweenEntries: 0 },
    } as SymbolOptions;
    recordTradeFillForRateLimit("RATEBTC");
    expect(
      mayExecuteAlgorithmicTrade("BUY", "BUY", {
        hasTradeHistory: true,
        symbolKey: "RATEBTC",
        symbolOptions: opts,
        blockStaleCandles: false,
      })
    ).toBe(false);
    expect(
      mayExecuteAlgorithmicTrade("STOP_LOSS", "SELL", {
        hasTradeHistory: true,
        symbolKey: "RATEBTC",
        symbolOptions: opts,
        blockStaleCandles: false,
      })
    ).toBe(true);
    resetTradeRateLimit("RATEBTC");
  });
});

describe("simFeeRatePerLeg", () => {
  it("defaults to 0.075% per leg", () => {
    expect(simFeeRatePerLeg()).toBeCloseTo(0.00075);
  });

  it("uses tradeFeePercentage from config", () => {
    expect(simFeeRatePerLeg(0.1)).toBeCloseTo(0.001);
  });
});

describe("fee adjustment", () => {
  it("subtracts full round-trip when no commission recorded", () => {
    expect(feePctPointsToSubtractFromPnl(0.1)).toBeCloseTo(0.2);
    expect(applyFeeAdjustmentToPnl(2, 0.1)).toBeCloseTo(1.8);
  });

  it("uses actual open commission + estimated close leg", () => {
    const lastTrade = { commission: "0.75", quoteQty: "1000" };
    expect(commissionPctPointsFromTrade(lastTrade)).toBeCloseTo(0.075);
    expect(feePctPointsToSubtractFromPnl(0.075, lastTrade)).toBeCloseTo(0.15);
  });

  it("roundTripPnlAfterFees uses commission when present", () => {
    const older = { commission: "1", quoteQty: "1000", commissionAsset: "EUR", symbol: "BTCEUR" };
    const last = { commission: "1", quoteQty: "1000", commissionAsset: "EUR", symbol: "BTCEUR" };
    expect(roundTripPnlAfterFees(2, older, last, 0.1)).toBeCloseTo(1.8);
  });

  it("ignores BNB commission vs quote notional and falls back to configured fee", () => {
    const bnb = { commission: "0.0002", quoteQty: "1000", commissionAsset: "BNB", symbol: "BTCEUR" };
    expect(commissionPctPointsFromTrade(bnb)).toBe(0);
    expect(roundTripPnlAfterFees(2, bnb, bnb, 0.1)).toBeCloseTo(1.8);
  });

  it("uses quote-asset commission when symbol is known", () => {
    expect(
      commissionPctPointsFromTrade({
        commission: "0.75",
        quoteQty: "1000",
        commissionAsset: "EUR",
        symbol: "BTC/EUR",
      })
    ).toBeCloseTo(0.075);
  });
});

describe("liveEntryBuyPriceAcceptable", () => {
  it("blocks excessive entry price above mid", () => {
    const ob = { bids: { "100": 1 }, asks: { "102": 1 } };
    expect(liveEntryBuyPriceAcceptable(101, ob, 0.1, "SKIP")).toBe(true);
    expect(liveEntryBuyPriceAcceptable(105, ob, 0.1, "SKIP")).toBe(false);
  });

  it("allows stop-loss buys regardless of slippage", () => {
    const ob = { bids: { "100": 1 }, asks: { "102": 1 } };
    expect(liveEntryBuyPriceAcceptable(200, ob, 0.1, "STOP_LOSS")).toBe(true);
  });
});
