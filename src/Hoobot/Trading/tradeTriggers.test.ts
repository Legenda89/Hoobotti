import { annotateTradesWithTriggers, recordTradeTrigger } from "./tradeTriggers";
import type { Trade } from "../Exchanges/Trades";

const trade = (over: Partial<Trade> = {}): Trade =>
  ({
    symbol: "BTCEUR",
    id: "1",
    orderId: "99",
    orderListID: 0,
    price: "100",
    qty: "1",
    quoteQty: "100",
    commission: "0",
    commissionAsset: "EUR",
    time: Date.now(),
    isBuyer: true,
    isMaker: false,
    isBestMatch: true,
    ...over,
  }) as Trade;

describe("tradeTriggers", () => {
  it("annotates trade by orderId", () => {
    recordTradeTrigger("BTC/EUR", "STOP_LOSS", { orderId: "99", time: Date.now() });
    const out = annotateTradesWithTriggers("BTC/EUR", [trade({ profit: undefined })]);
    expect(out[0]?.profit).toBe("STOP_LOSS");
  });

  it("keeps existing profit", () => {
    const out = annotateTradesWithTriggers("BTC/EUR", [trade({ profit: "TAKE_PROFIT", orderId: "nope" })]);
    expect(out[0]?.profit).toBe("TAKE_PROFIT");
  });
});
