import type { Trade } from "../Exchanges/Trades";
import { markTakeProfitPartialTaken, resetTakeProfitRuntimeForSymbol } from "../Indicators/takeProfitPositionState";
import {
  hasOpenAlgorithmicPosition,
  hasOpenPositionFromTradeHistory,
  hasTradeHistory,
  resolveOpenPositionEntryTrade,
} from "./positionState";

const trade = (isBuyer: boolean): Trade =>
  ({
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
    isBuyer,
    isMaker: true,
    isBestMatch: true,
  }) as Trade;

describe("positionState", () => {
  beforeEach(() => resetTakeProfitRuntimeForSymbol("BTCEUR"));

  it("detects open long when last trade is buy", () => {
    expect(hasOpenPositionFromTradeHistory([trade(true)])).toBe(true);
    expect(hasOpenPositionFromTradeHistory([trade(true), trade(false), trade(true)])).toBe(true);
  });

  it("is flat when last trade is sell even with history", () => {
    expect(hasOpenPositionFromTradeHistory([trade(true), trade(false)])).toBe(false);
    expect(hasOpenPositionFromTradeHistory(undefined)).toBe(false);
  });

  it("tracks trade history separately from open position", () => {
    const closed = [trade(true), trade(false)];
    expect(hasTradeHistory(closed)).toBe(true);
    expect(hasOpenPositionFromTradeHistory(closed)).toBe(false);
  });

  it("treats partial TP remainder as open and resolves entry buy", () => {
    const history = [trade(true), trade(false)];
    markTakeProfitPartialTaken("BTCEUR", "sell");
    expect(hasOpenAlgorithmicPosition(history, "BTCEUR")).toBe(true);
    expect(resolveOpenPositionEntryTrade(history, "BTCEUR")).toBe(history[0]);
  });
});
