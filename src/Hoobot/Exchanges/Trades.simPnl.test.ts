import { computeSimBuyClosePnl } from "./Trades";

describe("computeSimBuyClosePnl", () => {
  it("computes short close PnL with single open short in history", () => {
    const pnl = computeSimBuyClosePnl(
      [
        {
          symbol: "BTCUSDT",
          id: "",
          orderId: "",
          orderListID: 0,
          price: "100",
          qty: "1",
          quoteQty: "100",
          commission: "0",
          commissionAsset: "",
          time: 0,
          isBuyer: false,
          isMaker: true,
          isBestMatch: true,
        },
      ],
      90,
      0
    );
    expect(pnl).toBeGreaterThan(0);
  });

  it("returns 0 when no short to close", () => {
    expect(computeSimBuyClosePnl([], 100, 0)).toBe(0);
  });
});
