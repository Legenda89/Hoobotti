import { placeBuyOrder, placeSellOrder, averageFillPriceFromOrder, formatLiveTradeLogLine } from "./Trades";
import type { ExchangeOptions } from "../Utilities/Args";

const dryExchangeOptions = { dryRun: true, name: "binance" } as ExchangeOptions;
const exchange = {} as Parameters<typeof placeBuyOrder>[0];

describe("placeBuyOrder / placeSellOrder mode (dry run)", () => {
  it("defaults to limit mode", async () => {
    const order = await placeBuyOrder(exchange, dryExchangeOptions, "BTC/USDT", 0.01, 50_000);
    expect(order?.orderId).toBe("dry-run-buy");
  });

  it("accepts market mode without valid limit price", async () => {
    const order = await placeBuyOrder(exchange, dryExchangeOptions, "BTC/USDT", 0.01, NaN, 5, { mode: "market" });
    expect(order?.orderId).toBe("dry-run-buy");
  });

  it("rejects limit mode when price is NaN", async () => {
    const order = await placeBuyOrder(exchange, dryExchangeOptions, "BTC/USDT", 0.01, NaN, 5, { mode: "limit" });
    expect(order).toBeUndefined();
  });

  it("placeSellOrder supports market mode in dry run", async () => {
    const order = await placeSellOrder(exchange, dryExchangeOptions, "BTC/USDT", 0.01, 50_000, 5, { mode: "market" });
    expect(order?.orderId).toBe("dry-run-sell");
  });

  it("placeSellOrder rejects limit without price", async () => {
    const order = await placeSellOrder(exchange, dryExchangeOptions, "BTC/USDT", 0.01, NaN, 5, { mode: "limit" });
    expect(order).toBeUndefined();
  });
});

describe("averageFillPriceFromOrder / formatLiveTradeLogLine", () => {
  it("averages Binance fills", () => {
    expect(
      averageFillPriceFromOrder({
        price: "0",
        fills: [
          { price: "100", qty: "1" },
          { price: "102", qty: "1" },
        ],
      })
    ).toBeCloseTo(101);
  });

  it("uses quoteQty / qty when fills missing", () => {
    expect(averageFillPriceFromOrder({ quoteQty: "200", qty: "2", price: "0" })).toBeCloseTo(100);
  });

  it("logs unix ms timestamp and fill price for market sells", () => {
    const line = formatLiveTradeLogLine({
      symbol: "BTC/EUR",
      mode: "market",
      side: "sell",
      qty: 0.00188,
      order: { fills: [{ price: "54615.89", qty: "0.00188" }] },
    });
    expect(line).toMatch(/^\d{13} BTC\/EUR market sell 0\.00188 qty @ 54615\.89 ok$/);
  });
});
