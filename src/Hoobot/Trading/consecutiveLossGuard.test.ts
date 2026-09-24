import type { SymbolOptions } from "../Utilities/Args";
import {
  consecutiveLossSkipsRemaining,
  isAlgorithmicEntryTrade,
  lastCompletedRoundTripPnlPct,
  recordClosedRoundTripFromHistory,
  registerConsecutiveLossAfterClose,
  resetConsecutiveLossGuard,
  shouldBlockConsecutiveLossEntry,
} from "./consecutiveLossGuard";
import { markTakeProfitPartialTaken, resetTakeProfitRuntimeForSymbol } from "../Indicators/takeProfitPositionState";
import { mayExecuteAlgorithmicTrade } from "./tradeGates";

const sym = (over?: Partial<SymbolOptions>): SymbolOptions =>
  ({
    name: "BTC/EUR",
    tradeFeePercentage: 0.1,
    blockConsecutiveLoss: { enabled: true, skipEntries: 1, cooldownMinutes: 0 },
    ...over,
  }) as SymbolOptions;

describe("consecutiveLossGuard", () => {
  beforeEach(() => resetConsecutiveLossGuard());

  it("registers skip after losing close", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym(), -0.5);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(1);
  });

  it("does not register skip after winning close", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym(), 0.8);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(0);
  });

  it("blocks one entry attempt then allows the next", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym(), -0.3);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym(), "BUY", "BUY")).toBe(true);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(0);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym(), "BUY", "BUY")).toBe(false);
  });

  it("blocks during cooldown without consuming skip entries", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym({ blockConsecutiveLoss: { enabled: true, skipEntries: 2, cooldownMinutes: 30 } }), -0.3);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym({ blockConsecutiveLoss: { enabled: true, skipEntries: 2, cooldownMinutes: 30 } }), "BUY", "BUY")).toBe(true);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym({ blockConsecutiveLoss: { enabled: true, skipEntries: 2, cooldownMinutes: 30 } }), "BUY", "BUY")).toBe(true);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(2);
  });

  it("does not block stop loss exits", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym(), -1);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym(), "SELL", "STOP_LOSS")).toBe(false);
  });

  it("skips round-trip loss registration while partial TP remainder is open", () => {
    resetTakeProfitRuntimeForSymbol("BTCEUR");
    markTakeProfitPartialTaken("BTCEUR", "sell");
    const trades = [
      {
        symbol: "BTCEUR",
        id: "1",
        orderId: "1",
        orderListID: 0,
        price: "100",
        qty: "1",
        quoteQty: "100",
        commission: "0",
        commissionAsset: "EUR",
        time: 1,
        isBuyer: true,
        isMaker: true,
        isBestMatch: true,
      },
      {
        symbol: "BTCEUR",
        id: "2",
        orderId: "2",
        orderListID: 0,
        price: "90",
        qty: "0.5",
        quoteQty: "45",
        commission: "0",
        commissionAsset: "EUR",
        time: 2,
        isBuyer: false,
        isMaker: true,
        isBestMatch: true,
      },
    ] as const;
    recordClosedRoundTripFromHistory("BTCEUR", sym(), [...trades]);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(0);
  });

  it("does not block soft SELL close or STALE_EXIT as entries", () => {
    registerConsecutiveLossAfterClose("BTCEUR", sym(), -1);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym(), "SELL", "SELL")).toBe(false);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", sym(), "SELL", "STALE_EXIT")).toBe(false);
  });

  it("computes last round-trip pnl from trade history", () => {
    const pnl = lastCompletedRoundTripPnlPct(
      [
        {
          symbol: "BTCEUR",
          id: "1",
          orderId: "1",
          orderListID: 0,
          price: "100",
          qty: "1",
          quoteQty: "100",
          commission: "0",
          commissionAsset: "EUR",
          time: 1,
          isBuyer: true,
          isMaker: true,
          isBestMatch: true,
        },
        {
          symbol: "BTCEUR",
          id: "2",
          orderId: "2",
          orderListID: 0,
          price: "99",
          qty: "1",
          quoteQty: "99",
          commission: "0",
          commissionAsset: "EUR",
          time: 2,
          isBuyer: false,
          isMaker: true,
          isBestMatch: true,
        },
      ],
      0.1
    );
    expect(pnl).toBeLessThan(0);
  });
});

describe("mayExecuteAlgorithmicTrade consecutive loss", () => {
  beforeEach(() => resetConsecutiveLossGuard());

  it("blocks buy entry after loss when enabled", () => {
    const symbolOptions = sym();
    registerConsecutiveLossAfterClose("BTCEUR", symbolOptions, -0.4);
    expect(
      mayExecuteAlgorithmicTrade("BUY", "BUY", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions,
      })
    ).toBe(false);
    expect(
      mayExecuteAlgorithmicTrade("BUY", "BUY", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions,
      })
    ).toBe(true);
  });

  it("allows STALE_EXIT close while consecutive-loss guard is active", () => {
    const symbolOptions = sym();
    registerConsecutiveLossAfterClose("BTCEUR", symbolOptions, -0.4);
    expect(
      mayExecuteAlgorithmicTrade("STALE_EXIT", "SELL", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions,
      })
    ).toBe(true);
  });

  it("allows soft SELL close while consecutive-loss guard is active", () => {
    const symbolOptions = sym();
    registerConsecutiveLossAfterClose("BTCEUR", symbolOptions, -0.4);
    expect(
      mayExecuteAlgorithmicTrade("SELL", "SELL", {
        hasTradeHistory: true,
        symbolKey: "BTCEUR",
        symbolOptions,
      })
    ).toBe(true);
  });

  it("respects disabled config", () => {
    const symbolOptions = sym({ blockConsecutiveLoss: { enabled: false } });
    registerConsecutiveLossAfterClose("BTCEUR", symbolOptions, -0.4);
    expect(consecutiveLossSkipsRemaining("BTCEUR")).toBe(0);
    expect(shouldBlockConsecutiveLossEntry("BTCEUR", symbolOptions, "BUY", "BUY")).toBe(false);
  });
});

describe("isAlgorithmicEntryTrade", () => {
  it("treats opens as entry but not long soft-close or forced exits", () => {
    expect(isAlgorithmicEntryTrade("BUY", "SKIP")).toBe(true);
    expect(isAlgorithmicEntryTrade("BUY", "BUY")).toBe(true);
    expect(isAlgorithmicEntryTrade("SELL", "SKIP")).toBe(true);
    expect(isAlgorithmicEntryTrade("SELL", "STOP_LOSS")).toBe(false);
    expect(isAlgorithmicEntryTrade("SELL", "SELL")).toBe(false);
    expect(isAlgorithmicEntryTrade("SELL", "STALE_EXIT")).toBe(false);
  });
});
