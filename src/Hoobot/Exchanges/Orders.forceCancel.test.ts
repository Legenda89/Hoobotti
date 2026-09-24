import type { Client } from "discord.js";
import { handleOpenOrders, type Order } from "./Orders";
import type { Orderbook } from "./Orderbook";
import type { ConfigOptions, SymbolOptions } from "../Utilities/Args";

jest.mock("../../Discord/discord", () => ({
  sendMessageToChannel: jest.fn(),
}));

const openOrder = (): Order => ({
  symbol: "BTCEUR",
  orderId: "sell-limit-1",
  price: "101",
  qty: "1",
  quoteQty: "101",
  commission: "",
  commissionAsset: "",
  time: Date.now() - 60_000,
  isBuyer: false,
  isMaker: true,
  isBestMatch: true,
  orderStatus: "NEW",
  tradeId: 1,
});

const book = (): Orderbook =>
  ({
    bids: { "100": 1 },
    asks: { "101": 1 },
  }) as unknown as Orderbook;

describe("handleOpenOrders forceCancelOpenOrders", () => {
  it("cancels all open orders and allows trade when STOP_LOSS override is active", async () => {
    const cancel = jest.fn().mockResolvedValue({});
    const openOrders = jest.fn().mockResolvedValue([openOrder()]);
    const exchange = {
      candlesticks: jest.fn(),
      openOrders,
      cancel,
    };
    const symbolOptions = { maximumAgeOfOrder: 60, closePercentage: 0.35 } as SymbolOptions;

    const handled = await handleOpenOrders(
      undefined as unknown as Client,
      exchange as never,
      "BTC/EUR",
      book(),
      {} as ConfigOptions,
      symbolOptions,
      { forceCancelOpenOrders: true }
    );

    expect(handled).toBe(true);
    expect(openOrders).toHaveBeenCalledWith("BTCEUR");
    expect(cancel).toHaveBeenCalledWith("BTCEUR", "sell-limit-1");
    expect(symbolOptions.currentOrder).toBeUndefined();
  });

  it("blocks new trade when open order exists without force override", async () => {
    const cancel = jest.fn();
    const exchange = {
      candlesticks: jest.fn(),
      openOrders: jest.fn().mockResolvedValue([openOrder()]),
      cancel,
    };
    const symbolOptions = { maximumAgeOfOrder: 60, closePercentage: 0.35 } as SymbolOptions;

    const handled = await handleOpenOrders(
      undefined as unknown as Client,
      exchange as never,
      "BTC/EUR",
      book(),
      {} as ConfigOptions,
      symbolOptions
    );

    expect(handled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });
});
