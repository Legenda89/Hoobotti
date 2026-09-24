import { shouldRepriceOpenOrder, canRepriceOpenOrder, type Order } from "./Orders";
import type { Orderbook } from "./Orderbook";
import type { SymbolOptions } from "../Utilities/Args";

const order = (price: string, isBuyer: boolean): Order => ({
  symbol: "BTCEUR",
  orderId: "1",
  price,
  qty: "1",
  quoteQty: price,
  commission: "",
  commissionAsset: "",
  time: Date.now(),
  isBuyer,
  isMaker: true,
  isBestMatch: true,
  orderStatus: "NEW",
  tradeId: 1,
});

const book = (bid: number, ask: number): Orderbook =>
  ({
    bids: { [String(bid)]: 1 },
    asks: { [String(ask)]: 1 },
  } as unknown as Orderbook);

const sym = { closePercentage: 0.2 } as SymbolOptions;

describe("shouldRepriceOpenOrder", () => {
  it("reprices a buy order when best bid moved above the limit", () => {
    const decision = shouldRepriceOpenOrder(order("100", true), book(100.2, 100.4), sym);
    expect(decision.shouldReprice).toBe(true);
  });

  it("keeps a buy order when movement is inside threshold", () => {
    const decision = shouldRepriceOpenOrder(order("100", true), book(100.05, 100.2), sym);
    expect(decision.shouldReprice).toBe(false);
  });

  it("reprices a sell order when best ask moved below the limit", () => {
    const decision = shouldRepriceOpenOrder(order("100", false), book(99.5, 99.8), sym);
    expect(decision.shouldReprice).toBe(true);
  });

  it("does not chase a buy order when the book moved down", () => {
    const decision = shouldRepriceOpenOrder(order("100", true), book(99, 99.2), sym);
    expect(decision.shouldReprice).toBe(false);
  });
});

describe("canRepriceOpenOrder", () => {
  it("allows reprice for NEW orders", () => {
    expect(canRepriceOpenOrder(order("100", true))).toBe(true);
  });

  it("blocks reprice for partially filled orders", () => {
    expect(canRepriceOpenOrder({ ...order("100", true), orderStatus: "PARTIALLY_FILLED" })).toBe(false);
  });

  it("reads Binance status field when orderStatus is missing", () => {
    const { orderStatus: _ignored, ...rest } = order("100", true);
    const raw = { ...rest, status: "PARTIALLY_FILLED" } as unknown as Order;
    expect(canRepriceOpenOrder(raw)).toBe(false);
  });
});
