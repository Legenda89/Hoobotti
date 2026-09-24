/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are not permitted without prior written permission
 * from Hoosat Oy. Unauthorized reproduction, copying, or use of this
 * software, in whole or in part, is strictly prohibited. All
 * modifications in source or binary must be submitted to Hoosat Oy in source format.
 *
 * THIS SOFTWARE IS PROVIDED BY HOOSAT OY "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL HOOSAT OY BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The user of this software uses it at their own risk. Hoosat Oy shall
 * not be liable for any losses, damages, or liabilities arising from
 * the use of this software.
 * ===================================================================== */
import { sendMessageToChannel } from "../../Discord/discord";
import { Client } from "discord.js";
import { ConfigOptions, ExchangeOptions, SymbolOptions, toSymbolKey } from "../Utilities/Args";
import { consoleLogger } from "../Utilities/ConsoleLogger";
import { calculateUnrealizedPNLPercentageForLong, calculateUnrealizedPNLPercentageForShort, delay } from "./Trades";
import { Orderbook } from "./Orderbook";
import { logToFile } from "../Utilities/LogToFile";
import { Exchange, isBinance, isNonKYC } from "./Exchange";
import { Filter } from "./Filters";
import { isFullOrderFill } from "../Trading/orderFill";

export interface Order {
  symbol: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
  orderStatus: string;
  tradeId: number;
}

export interface OrderStatus {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  icebergQty: string;
  time: number;
  updateTime: number;
  isWorking: true;
  workingTime: number;
  origQuoteOrderQty: string;
  selfTradePreventionMode: string;
}

export const getOpenOrders = async (exchange: Exchange, symbol: string): Promise<Order[]> => {
  if (isBinance(exchange)) {
    return await exchange.openOrders(toSymbolKey(symbol));
  } else if (isNonKYC(exchange)) {
    const orders = await exchange.getAllOrders(symbol, "active", 500, 0);
    return orders.map(
      (order: any) =>
        ({
          symbol: toSymbolKey(symbol),
          orderId: order.id,
          price: order.price,
          qty: order.quantity,
          quoteQty: (parseFloat(order.quantity) * parseFloat(order.price)).toString(),
          commission: "",
          commissionAsset: "",
          time: order.createdAt,
          isBuyer: order.side === "buy" ? true : false,
          isMaker: true,
          isBestMatch: true,
          orderStatus: order.status,
          tradeId: parseFloat(order.id),
        } as Order)
    );
  }
  return [] as Order[];
};

export const getAllOrders = async (exchange: Exchange, symbol: string): Promise<Order[]> => {
  if (isBinance(exchange)) {
    return await exchange.allOrders(toSymbolKey(symbol));
  } else if (isNonKYC(exchange)) {
    const activeOrders = await exchange.getAllOrders(symbol, "active", 500, 0);
    const filledOrders = await exchange.getAllOrders(symbol, "filled", 500, 0);
    const canceledOrders = await exchange.getAllOrders(symbol, "cancelled", 500, 0);
    const orders = [...activeOrders, ...filledOrders, ...canceledOrders];
    return orders.map(
      (order: any) =>
        ({
          symbol: toSymbolKey(symbol),
          orderId: order.id,
          price: order.price,
          qty: order.quantity,
          quoteQty: (parseFloat(order.quantity) * parseFloat(order.price)).toString(),
          commission: "",
          commissionAsset: "",
          time: order.createdAt,
          isBuyer: order.side === "buy" ? true : false,
          isMaker: true,
          isBestMatch: true,
          orderStatus: order.status,
          tradeId: parseFloat(order.id),
        } as Order)
    );
  }
  return [] as Order[];
};

export const getOrder = async (exchange: Exchange, symbol: string, orderId: string) => {
  if (isBinance(exchange)) {
    const response = await exchange.orderStatus(toSymbolKey(symbol), orderId);
    return response;
  } else if (isNonKYC(exchange)) {
    const order = await exchange.getOrderByID(orderId);
    return {
      symbol: toSymbolKey(symbol),
      orderId: order.id,
      price: order.price,
      qty: order.quantity,
      quoteQty: (parseFloat(order.quantity) * parseFloat(order.price)).toString(),
      commission: "",
      commissionAsset: "",
      time: order.createdAt,
      isBuyer: order.side === "buy" ? true : false,
      isMaker: true,
      isBestMatch: true,
      orderStatus: order.status,
      tradeId: parseFloat(order.id),
    } as Order;
  }
};

export const cancelOrder = async (exchange: Exchange, symbol: string, orderId: string) => {
  if (isBinance(exchange)) {
    const response = await exchange.cancel(symbol, orderId);
    return response;
  } else if (isNonKYC(exchange)) {
    const response = await exchange.cancelOrder(orderId);
    return response;
  }
};

export const openOrders = async (exchange: Exchange, symbol: string): Promise<boolean | Order[]> => {
  return getOpenOrders(exchange, symbol);
};

const bestBid = (orderBook: Orderbook): number | undefined => {
  const bids = Object.keys(orderBook.bids ?? {})
    .map((price) => parseFloat(price))
    .filter((price) => Number.isFinite(price))
    .sort((a, b) => b - a);
  return bids[0];
};

const bestAsk = (orderBook: Orderbook): number | undefined => {
  const asks = Object.keys(orderBook.asks ?? {})
    .map((price) => parseFloat(price))
    .filter((price) => Number.isFinite(price))
    .sort((a, b) => a - b);
  return asks[0];
};

export type OpenOrderRepriceDecision = {
  shouldReprice: boolean;
  referencePrice?: number;
  distancePct: number;
  thresholdPct: number;
};

/** Binance openOrders uses `status`; our Order type uses `orderStatus`. */
const openOrderStatus = (order: Order): string | undefined =>
  order.orderStatus ?? (order as Order & { status?: string }).status;

/** Reprice only untouched limit orders — not partial fills. */
export const canRepriceOpenOrder = (order: Order): boolean => {
  const status = openOrderStatus(order);
  return status === undefined || status === "NEW";
};

export const shouldRepriceOpenOrder = (
  order: Order,
  orderBook: Orderbook,
  symbolOptions: SymbolOptions
): OpenOrderRepriceDecision => {
  const orderPrice = parseFloat(order.price);
  if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
    return { shouldReprice: false, distancePct: 0, thresholdPct: 0 };
  }
  const referencePrice = order.isBuyer ? bestBid(orderBook) : bestAsk(orderBook);
  if (referencePrice === undefined || referencePrice <= 0) {
    return { shouldReprice: false, distancePct: 0, thresholdPct: 0 };
  }
  const distancePct = Math.abs(((referencePrice - orderPrice) / orderPrice) * 100);
  const thresholdPct = Math.max(0.03, (symbolOptions.closePercentage ?? 0.25) / 2);
  const isBehindBook = order.isBuyer ? orderPrice < referencePrice : orderPrice > referencePrice;
  return {
    shouldReprice: isBehindBook && distancePct >= thresholdPct,
    referencePrice,
    distancePct,
    thresholdPct,
  };
};

const roundToStep = (value: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
};

export const checkBeforePlacingOrder = (baseQuantity: number, price: number, tradingPairFilters: Filter) => {
  const isValid = (min: number, max: number, value: number) => {
    if (value < min) return false;
    if (max > 0 && value > max) return false;
    return true;
  };

  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) return false;

  const roundedPrice = roundToStep(price, tradingPairFilters.tickSize);
  const roundedQty = roundToStep(baseQuantity, tradingPairFilters.stepSize);
  const notional = roundedQty * roundedPrice;

  // Explicit zero-guards: Binance minPrice can be 0, which would otherwise allow 0.00 orders.
  if (!Number.isFinite(roundedPrice) || roundedPrice <= 0) return false;
  if (!Number.isFinite(roundedQty) || roundedQty <= 0) return false;
  if (!Number.isFinite(notional) || notional <= 0) return false;

  if (process.env.DEBUG === "true") {
    console.log("checkBeforePlacingOrder", {
      baseQuantity,
      roundedQty,
      price,
      roundedPrice,
      notional,
      filters: tradingPairFilters,
    });
  }

  const minPrice = Math.max(tradingPairFilters.minPrice ?? 0, Number.MIN_VALUE);
  const minQty = Math.max(tradingPairFilters.minQty ?? 0, Number.MIN_VALUE);
  const minNotional = Math.max(tradingPairFilters.minNotional ?? 0, 0);

  const priceOk = isValid(minPrice, tradingPairFilters.maxPrice, roundedPrice) && roundedPrice > 0;
  const qtyOk = isValid(minQty, tradingPairFilters.maxQty, roundedQty) && roundedQty > 0;
  const notionalOk =
    (minNotional <= 0 ? notional > 0 : isValid(minNotional, tradingPairFilters.maxNotional, notional)) &&
    notional > 0;

  if (!priceOk || !qtyOk || !notionalOk) {
    if (process.env.DEBUG === "true") {
      console.log("ORDER BLOCKED BY FILTERS", { priceOk, qtyOk, notionalOk, roundedQty, roundedPrice, notional });
    }
    return false;
  }
  return true;
};

export const handleOpenOrders = async (
  discord: Client,
  exchange: Exchange,
  symbol: string,
  orderBook: Orderbook,
  processOptions: ConfigOptions,
  symbolOptions: SymbolOptions,
  opts?: {
    /**
     * Live-trade-override (STOP_LOSS / TAKE_PROFIT(_FORCE)) haluaa aina edetä,
     * vaikka avoimia tilauksia olisi yhä voimassa.
     *
     * Tällöin perutaan kaikki symbolin avoimet tilaukset ennen uuden tilaamisen.
     */
    forceCancelOpenOrders?: boolean;
  }
) => {
  var openOrders = await getOpenOrders(exchange, symbol);
  if (openOrders.length == 0) {
    symbolOptions.currentOrder = undefined;
    return true;
  }

  if (opts?.forceCancelOpenOrders === true) {
    for (const o of openOrders) {
      await cancelOrder(exchange, toSymbolKey(symbol), o.orderId);
      const orderMsg = `>>> Order ID **${o.orderId}**\nSymbol **${symbol
        .split("/")
        .join("")}**\nOrder Cancelled (force override).\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
      sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
    }
    symbolOptions.currentOrder = undefined;
    return true;
  }

  for (var i = 0; i < openOrders.length; i++) {
    const currentTime = Date.now();
    const orderAgeSeconds = Math.floor((currentTime - openOrders[i].time) / 1000);
    var maxOrderAge = symbolOptions.maximumAgeOfOrder! * 60;
    // console.log(orderAgeSeconds);
    // console.log(maxOrderAge);
    // console.log(orderAgeSeconds > maxOrderAge);
    if (orderAgeSeconds > maxOrderAge) {
      await cancelOrder(exchange, toSymbolKey(symbol), openOrders[i].orderId);
      const orderMsg = `>>> Order ID **${openOrders[i].orderId}**\nSymbol **${symbol
        .split("/")
        .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
      sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
      symbolOptions.currentOrder = undefined;
      return true;
    } else {
      const reprice = canRepriceOpenOrder(openOrders[i])
        ? shouldRepriceOpenOrder(openOrders[i], orderBook, symbolOptions)
        : { shouldReprice: false, distancePct: 0, thresholdPct: 0 };
      if (reprice.shouldReprice) {
        await cancelOrder(exchange, toSymbolKey(symbol), openOrders[i].orderId);
        const orderMsg = `>>> Order ID **${openOrders[i].orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder cancelled for reprice. Order ${openOrders[i].price}, book ${reprice.referencePrice}, distance ${reprice.distancePct.toFixed(3)}%.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        symbolOptions.currentOrder = undefined;
        return true;
      }
      let unrealizedPNL = 0;
      if (openOrders[i].isBuyer === true) {
        // console.log("Checking bids");
        const orderBookBids = Object.keys(orderBook.bids)
          .map((price) => parseFloat(price))
          .sort((a, b) => b - a);
        unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
          parseFloat(openOrders[i].qty),
          parseFloat(openOrders[i].price),
          orderBookBids[0]
        );
      } else {
        // console.log("Checking asks");
        const orderBookAsks = Object.keys(orderBook.asks)
          .map((price) => parseFloat(price))
          .sort((a, b) => a - b);
        unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
          parseFloat(openOrders[i].qty),
          parseFloat(openOrders[i].price),
          orderBookAsks[0]
        );
      }
      // console.log(unrealizedPNL);
      if (unrealizedPNL > symbolOptions.closePercentage!) {
        await cancelOrder(exchange, toSymbolKey(symbol), openOrders[i].orderId);
        const orderMsg = `>>> Order ID **${openOrders[i].orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        symbolOptions.currentOrder = undefined;
        return true;
      }
    }
  }
  return false;
};

export const handleOpenOrder = async (
  discord: Client,
  exchange: Exchange,
  symbol: string,
  order: Order,
  orderBook: Orderbook,
  processOptions: ConfigOptions,
  symbolOptions: SymbolOptions
): Promise<string> => {
  if (isBinance(exchange)) {
    let partiallyFilledSent = false;
    const logger = consoleLogger();
    await delay(1500);
    let orderStatus;
    orderStatus = await exchange.orderStatus(toSymbolKey(symbol), order.orderId);
    if (orderStatus === undefined) {
      return "DOES_NOT_EXIST";
    }
    await delay(1500);
    do {
      await delay(1500);
      const currentTime = Date.now();
      const orderAgeSeconds = Math.floor((currentTime - orderStatus.time) / 1000);
      logger.push("Order ID: ", order.orderId);
      logger.push("Symbol: ", symbol);
      logger.push("Age seconds: ", orderAgeSeconds);
      let tryToCancel = false;
      if (orderStatus.status === "CANCELED") {
        const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        return "CANCELED";
      } else if (orderStatus.status === "EXPIRED") {
        const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder Expired.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        return "EXPIRED";
      } else if (isFullOrderFill(orderStatus.status, orderStatus.executedQty, orderStatus.origQty)) {
        const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder Filled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        return "FILLED";
      } else if (orderStatus.status === "NEW") {
        tryToCancel = true;
      } else if (orderStatus.status === "PARTIALLY_FILLED") {
        if (partiallyFilledSent === false) {
          const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
            .split("/")
            .join("")}**\nOrder Partially filled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
          sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
          partiallyFilledSent = true;
        }
        tryToCancel = true;
      } else if (orderStatus.status === "REJECTED") {
        const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
          .split("/")
          .join("")}**\nOrder Rejected.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
        sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
        return "REJECTED";
      }
      if (tryToCancel === true) {
        var maxOrderAge = symbolOptions.maximumAgeOfOrder! * 60;
        if (orderAgeSeconds > maxOrderAge) {
          await cancelOrder(exchange, toSymbolKey(symbol), order.orderId);
          const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
            .split("/")
            .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
          sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
          return "CANCELED";
        } else {
          if (orderStatus.status === "NEW") {
            const reprice = shouldRepriceOpenOrder(order, orderBook, symbolOptions);
            if (reprice.shouldReprice) {
              await cancelOrder(exchange, toSymbolKey(symbol), order.orderId);
              const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
                .split("/")
                .join("")}**\nOrder cancelled for reprice. Order ${order.price}, book ${reprice.referencePrice}, distance ${reprice.distancePct.toFixed(3)}%.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
              sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
              return "CANCELED";
            }
          }
          let unrealizedPNL = 0;
          if (order.isBuyer === true) {
            const orderBookBids = Object.keys(orderBook.bids)
              .map((price) => parseFloat(price))
              .sort((a, b) => b - a);
            unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
              parseFloat(order.qty),
              parseFloat(order.price),
              orderBookBids[0]
            );
          } else {
            const orderBookAsks = Object.keys(orderBook.asks)
              .map((price) => parseFloat(price))
              .sort((a, b) => a - b);
            unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
              parseFloat(order.qty),
              parseFloat(order.price),
              orderBookAsks[0]
            );
          }
          if (unrealizedPNL > symbolOptions.closePercentage!) {
            await cancelOrder(exchange, toSymbolKey(symbol), order.orderId);
            const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
              .split("/")
              .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
            sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
            return "CANCELED";
          }
        }
      }
      logger.print();
      logger.flush();
      orderStatus = await exchange.orderStatus(toSymbolKey(symbol), order.orderId);
      if (isFullOrderFill(orderStatus.status, orderStatus.executedQty, orderStatus.origQty)) {
        return "FILLED";
      }
      await delay(1500);
    } while (true);
  } else if (isNonKYC(exchange)) {
    do {
      const currentTime = Date.now();
      const activeOrders = await exchange.getAllOrders(symbol, "active", 500, 0);
      const filledOrders = await exchange.getAllOrders(symbol, "filled", 500, 0);
      const cancelledOrders = await exchange.getAllOrders(symbol, "cancelled", 500, 0);
      if (activeOrders !== undefined) {
        for (const activeOrder of activeOrders) {
          if (String(activeOrder.id) === order.orderId) {
            const orderAgeSeconds = Math.floor((currentTime - activeOrder.createdAt) / 1000);
            var maxOrderAge = symbolOptions.maximumAgeOfOrder! * 60;
            // console.log(orderAgeSeconds);
            // console.log(maxOrderAge);
            // console.log(orderAgeSeconds > maxOrderAge);
            if (orderAgeSeconds > maxOrderAge) {
              await cancelOrder(exchange, toSymbolKey(symbol), order.orderId);
              const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
                .split("/")
                .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
              sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
              return "CANCELED";
            } else {
              let unrealizedPNL = 0;
              if (order.isBuyer === true) {
                const orderBookBids = Object.keys(orderBook.bids)
                  .map((price) => parseFloat(price))
                  .sort((a, b) => b - a);
                unrealizedPNL = calculateUnrealizedPNLPercentageForShort(
                  parseFloat(order.qty),
                  parseFloat(order.price),
                  orderBookBids[0]
                );
              } else {
                const orderBookAsks = Object.keys(orderBook.asks)
                  .map((price) => parseFloat(price))
                  .sort((a, b) => a - b);
                unrealizedPNL = calculateUnrealizedPNLPercentageForLong(
                  parseFloat(order.qty),
                  parseFloat(order.price),
                  orderBookAsks[0]
                );
              }
              if (unrealizedPNL > symbolOptions.closePercentage!) {
                await cancelOrder(exchange, toSymbolKey(symbol), order.orderId);
                const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
                  .split("/")
                  .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
                sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
                return "CANCELED";
              }
            }
          }
        }
        let found = false;
        for (const filledOrder of filledOrders) {
          if (String(filledOrder.id) === order.orderId) {
            found = true;
          }
        }
        if (found == false) {
          if (cancelledOrders !== undefined) {
            for (const cancelledOrder of cancelledOrders) {
              if (String(cancelledOrder.id) === order.orderId) {
                const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
                  .split("/")
                  .join("")}**\nOrder Cancelled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
                sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
                return "CANCELED";
              }
            }
          }
          const orderMsg = `>>> Order ID **${order.orderId}**\nSymbol **${symbol
            .split("/")
            .join("")}**\nOrder Filled.\nTime now ${new Date().toLocaleString("fi-fi")}\n`;
          sendMessageToChannel(discord, processOptions.discord?.channelId, orderMsg);
          return "FILLED";
        }
      } else {
        return "DOES NOT EXIST";
      }
      await delay(30000);
    } while (true);
  }
  return "";
};
