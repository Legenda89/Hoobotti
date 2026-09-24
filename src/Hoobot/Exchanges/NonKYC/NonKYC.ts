import crypto from "crypto";
import EventEmitter from "events";
import { toSymbolKey } from "../../Utilities/Args";
import { logToFile } from "../../Utilities/LogToFile";
import { URL } from "url";
import WebSocket from "ws";

interface urlParams {
  [key: string]: string | string[];
}

export interface NonKYCOptions {
  wssHost: string;
  key: string;
  secret: string;
}

export interface NonKYCError {
  code: string;
  message: string;
}

export interface NonKYCResponse {
  jsonrpc: string;
  method?: string;
  params?: NonKYCTickers | NonKYCOrderbook | NonKYCCandles | NonKYCTrades;
  result?:
    | NonKYCAsset
    | NonKYCAsset[]
    | NonKYCMarket
    | NonKYCMarket[]
    | NonKYCBalance[]
    | NonKYCOrder
    | NonKYCOrder[]
    | boolean;
  error?: NonKYCError;
  id: number;
  name?: string;
}
export interface NonKYCTickers {
  data: NonKYCTicker[];
  symbol: string;
  period: number;
}

export interface NonKYCTrades {
  data: NonKYCTrade[];
  symbol: string;
  period: number;
}

export interface NonKYCTrade {
  id: string;
  price: string;
  quantity: string;
  side: string;
  timestamp: string;
}

export interface NonKYCBalance {
  asset: string;
  available: string;
  held: string;
}

export interface NonKYCOrder {
  id: string;
  userProvidedId: string;
  symbol: string;
  side: string;
  type: string;
  price: string;
  numberprice: number;
  quantity: string;
  executedQuantity: string;
  remainQuantity: string;
  remainTotal: string;
  remainTotalWithFee: string;
  lastTradeAt: number;
  status: string;
  isActive: boolean;
  isNew: boolean;
  createdAt: number;
  updatedAt: number;
  reportType: string;
}

export interface NonKYCCandles {
  data: NonKYCCandle[];
  symbol: string;
  period: number;
}

export interface NonKYCCandle {
  timestamp: string;
  open: string;
  close: string;
  min: string;
  max: string;
  volume: string;
}

export interface NonKYCOrderbook {
  asks: NonKYCAsks[];
  bids: NonKYCBids[];
  symbol: string;
  timestamp: string;
  sequence: number;
}

export interface NonKYCAsks {
  price: string;
  quantity: string | number;
}

export interface NonKYCBids {
  price: string;
  quantity: string | number;
}

export interface NonKYCTicker {
  symbol: string;
  lastPrice: string;
  lastPriceUpDown: string;
  yesterdayPrice: string;
  changePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  bestBid: string;
  bestAsk: string;
  spreadPercent: string;
  lastPriceNumber: number;
  yesterdayPriceNumber: number;
  changePercentNumber: number;
  highPriceNumber: number;
  lowPriceNumber: number;
  volumeNumber: number;
  volumeUsdNumber: number;
  bestBidNumber: number;
  bestAskNumber: number;
  lastTradeAt: number;
  updatedAt: number;
  sequence: number;
}

export interface NonKYCSocialLinks {
  Reddit: string;
  Twitter: string;
  Facebook: string;
  BitcoinTalk: string;
  Github: string;
}

export interface NonKYCAsset {
  _id: string;
  createdAt: number;
  updatedAt: number;
  ticker: string;
  name: string;
  network: string;
  logo: string;
  isActive: boolean;
  hasChildren: boolean;
  isChild: boolean;
  childOf: string | null;
  isToken: boolean;
  tokenDetails: string;
  useParentAddress: boolean;
  usdValue: string;
  depositActive: boolean;
  depositNotes: string;
  depositPayid: boolean;
  withdrawalActive: boolean;
  withdrawalNotes: string;
  withdrawalPayid: boolean;
  withdrawalPayidRequired: boolean;
  withdrawFeeMultiply: number;
  confirmsRequired: number;
  withdrawDecimals: number;
  isDeflationary: boolean;
  deflationPercent: number;
  withdrawFee: string;
  explorer: string;
  explorerTxid: string;
  explorerAddress: string;
  website: string;
  coinMarketCap: string;
  coinGecko: string;
  nomics: string;
  addressRegEx: string;
  payidRegEx: string;
  socialCommunity: NonKYCSocialLinks;
  coinGeckoApiId: string;
  tokenOf: string | null;
  lastPriceUpdate: number;
  circulation: string;
  marketcapNumber: number;
  coinPaprika: string;
  coinPaprikaApiId: string;
  coinCodex: string;
  coinCodexApiId: string;
  canLiquidityPool: boolean;
  canStake: boolean;
  canVote: boolean;
  imageUUID: string;
}

export interface NonKYCMarket {
  _id: string;
  createdAt: number;
  updatedAt: number;
  symbol: string;
  primaryName: string;
  primaryTicker: string;
  lastPrice: string;
  yesterdayPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  lastTradeAt: number;
  priceDecimals: number;
  quantityDecimals: number;
  isActive: boolean;
  primaryAsset: string;
  secondaryAsset: string;
  bestAsk: string;
  bestAskNumber: number;
  bestBid: string;
  bestBidNumber: number;
  changePercent: string;
  changePercentNumber: number;
  highPriceNumber: number;
  lastPriceNumber: number;
  lowPriceNumber: number;
  volumeNumber: number;
  yesterdayPriceNumber: number;
  volumeUsdNumber: number;
  primaryCirculation: string;
  primaryUsdValue: string;
  secondaryCirculation: string;
  secondaryUsdValue: string;
  marketcapNumber: number;
  spreadPercent: string;
  lastPriceUpDown: string;
  engineId: number;
  isPaused: boolean;
  imageUUID: string;
}

const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

var NonKYCBlocked: boolean = false;

const waitToBlock = async () => {
  while (NonKYCBlocked === true) {
    await delay(5);
  }
  NonKYCBlocked = true;
};

const unBlock = async () => {
  NonKYCBlocked = false;
};

/*
 * Utility class to map numbers to callbacks.
 */

class CallbackMap {
  private callbacks: Map<number, Function>;

  constructor() {
    this.callbacks = new Map();
  }

  public add(id: number, callback: Function): void {
    if (this.callbacks.has(id)) {
      console.warn(`Callback with ID ${id} already exists.`);
    }
    this.callbacks.set(id, callback);
  }

  public remove(id: number): void {
    this.callbacks.delete(id);
  }

  public get(id: number): Function | undefined {
    100;
    return this.callbacks.get(id);
  }

  public call(id: number, ...args: any[]): void {
    const callback = this.get(id);
    if (id === 0) {
      return;
    }
    if (callback) {
      callback(...args);
    } else {
      console.warn(`Callback with ID ${id} not found.`);
    }
  }
}

/*
 * NonKYC WebSocket API
 * const NonKYC = new NonKYC("key", "secret");
 * await NonKYC.waitConnect();
 * ...
 */

interface symbolCallbacks {
  symbol: string;
  tickerCallbackId: number;
  orderbookCallbackId: number;
  tradesCallbackId: number;
  candlesCallbackId: number;
}

interface Subscription {
  symbol: string;
  tickerCallback?: (response: NonKYCResponse) => void;
  orderbookCallback?: (response: NonKYCResponse) => void;
  tradesCallback?: (response: NonKYCResponse) => void;
  candlesCallback?: (response: NonKYCResponse) => void;
  candlesPeriod?: number;
  candlesLimit?: number;
}

export class NonKYC extends EventEmitter {
  private readonly WebSocketURL: string;
  private readonly ApiURL: string;
  private key: string;
  private secret: string;
  private messageId: number = 500000;
  private ws: WebSocket | null = null;
  private logged: boolean = false;
  private keepAlive: NodeJS.Timeout | undefined;
  private pingTimeout: NodeJS.Timeout | undefined;
  private symbolCallbacks: symbolCallbacks[] = [];
  private reportsCallbackId: number = 0;
  private reportsCallback?: (response: NonKYCResponse) => void;
  private callbackMap: CallbackMap;
  private emitter: EventEmitter;
  private forceStopOnDisconnect: boolean;
  private subscriptions: Subscription[] = []; // Store active subscriptions
  private maxReconnectionAttempts: number = 5; // Configurable max attempts

  constructor(key: string, secret: string, forceStopOnDisconnect: boolean) {
    super();
    this.WebSocketURL = "wss://ws.nonkyc.io";
    this.ApiURL = "https://api.nonkyc.io/api/v2";
    this.key = key;
    this.secret = secret;
    this.callbackMap = new CallbackMap();
    this.emitter = new EventEmitter();
    this.forceStopOnDisconnect = forceStopOnDisconnect;
    this.connect();
  }

  public NonKYC = () => {
    return "NonKYC";
  };

  private loopPing = () => {
    if (this.keepAlive) {
      clearTimeout(this.keepAlive);
    }

    this.keepAlive = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("Ping NonKYC.");
        this.ws.ping();
      }
      // schedule the next ping
      this.loopPing();
    }, 60000);
  };

  public waitConnect = () => {
    return new Promise((resolve, _reject) => {
      this.on("logged", () => {
        this.loopPing();
        resolve(true);
      });
    });
  };

  private connect = async (): Promise<WebSocket> => {
    this.ws = new WebSocket(this.WebSocketURL);

    this.ws.on("open", async () => {
      console.log("NonKYC WebSocket connected.");
      if (this.key && this.secret) {
        try {
          const result = await this.login();
          if (result === true) {
            this.emit("logged");
          }
        } catch (error) {
          console.error("Login failed during connection:", error);
        }
      }
    });

    this.ws.on("close", async (code: number) => {
      if (!this.forceStopOnDisconnect) {
        clearTimeout(this.pingTimeout);
        clearTimeout(this.keepAlive);
        console.log(`WebSocket closed with code ${code}.`);
        if (code === 1006) {
          console.log("WebSocket closed abnormally (1006). Attempting to reconnect...");
          delay(1000);
          this.emit("try-to-reconnect");
        }
      } else {
        clearTimeout(this.pingTimeout);
        clearTimeout(this.keepAlive);
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error("WebSocket encountered an error:", err);
      this.emitter.emit("websocket_error", err);
    });

    this.ws.on("ping", (data: Buffer) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("Received NonKYC Ping, replying with Pong.");
        this.ws.pong(data, true, (err?: Error) => {
          if (err) console.error("Error sending pong:", err);
        });
      }
    });

    this.ws.on("pong", (_data: Buffer) => {
      console.log("Received NonKYC Pong.");
    });

    this.ws.onmessage = (event: WebSocket.MessageEvent) => {
      this.onMessage(event);
    };
    return this.ws;
  };

  public disconnect() {
    try {
      if (this.ws) {
        this.forceStopOnDisconnect = true;
        this.ws.terminate();
        this.ws = null;
        console.log("NonKYC disconnected.");
      }
    } catch (err) {
      console.error("Error during disconnect:", err);
    }
  }

  private send = (message: any): void => {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(message), (err?: Error) => {
            if (err) {
              console.error("WebSocket send error:", err);
              // You could trigger a reconnect or custom error handling here
            } else {
              this.logged = true;
            }
          });
        } catch (error) {
          console.error("Unexpected WebSocket send exception:", error);
        }
      } else {
        console.warn("WebSocket is not open. ReadyState:", this.ws.readyState);
      }
    } else {
      throw new Error("WebSocket connection not established");
    }
  };

  private onMessage = (event: WebSocket.MessageEvent): void => {
    if (!this.ws) {
      console.error("WebSocket connection not established");
      throw new Error("WebSocket connection not established");
    }
    const response: NonKYCResponse = JSON.parse(event.data.toString("utf-8"));
    if (response.error) {
      console.error(`Message error: ${JSON.stringify(response, null, 4)}`);
    }
    if (response.id !== undefined) {
      this.emitter.emit(`response_${response.id}`, response);
    } else {
      let callbacks = this.symbolCallbacks.filter(
        (scb) => toSymbolKey(scb.symbol) === toSymbolKey((response.params as { symbol?: string })?.symbol ?? "")
      )[0];
      if (response.method === "ticker") {
        this.callbackMap.call(callbacks.tickerCallbackId, response);
      } else if (response.method === "snapshotOrderbook" || response.method === "updateOrderbook") {
        this.callbackMap.call(callbacks.orderbookCallbackId, response);
      } else if (response.method === "snapshotTrades" || response.method === "updateTrades") {
        this.callbackMap.call(callbacks.tradesCallbackId, response);
      } else if (response.method === "snapshotCandles" || response.method === "updateCandles") {
        this.callbackMap.call(callbacks.candlesCallbackId, response);
      } else {
        this.callbackMap.call(this.reportsCallbackId, response);
      }
    }
  };

  // Private NonKYC Websocket API calls

  private login = async (): Promise<boolean> => {
    let nonce = crypto.randomBytes(10).toString("hex");
    let hmac = crypto.createHmac("sha256", this.secret);
    hmac.update(nonce);
    let signature = hmac.digest("hex");
    let messageId = this.messageId++;
    this.send({
      method: "login",
      params: {
        algo: "HS256",
        pKey: this.key,
        nonce: nonce,
        signature: signature,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as boolean;
        if (result == true) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public newOrder = async (
    symbol: string,
    side: "buy" | "sell",
    type: "limit" | "market",
    quantity: number,
    price: number = 0,
    useProvidedId: string | null = null,
    strictValidate: boolean = false
  ): Promise<NonKYCOrder> => {
    let messageId = this.messageId++;
    this.send({
      method: "newOrder",
      params: {
        symbol: symbol,
        useProvidedId: useProvidedId,
        side: side,
        type: type,
        quantity: quantity.toString(),
        price: price.toString(),
        strictValidate: strictValidate,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCOrder;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public cancelOrder = async (orderId: string): Promise<NonKYCOrder> => {
    let messageId = this.messageId++;
    this.send({
      method: "cancelOrder",
      params: {
        orderId: orderId,
        useProvidedId: orderId,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCOrder;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getOrders = async (symbol: string): Promise<NonKYCOrder[]> => {
    let messageId = this.messageId++;
    this.send({
      method: "getOrders",
      params: {
        symbol: symbol,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCOrder[];
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getTradingBalance = async (): Promise<NonKYCBalance[]> => {
    let messageId = this.messageId++;
    this.send({
      method: "getTradingBalance",
      params: {},
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCBalance[];
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public subscribeReports = async (callback: (response: NonKYCResponse) => void) => {
    await waitToBlock();
    this.reportsCallback = callback; // Store callback
    this.send({
      method: "subscribeReports",
      params: {},
      id: this.reportsCallbackId,
    });
    this.callbackMap.add(this.reportsCallbackId, callback);
    console.log("Subscribed Reports");
    await unBlock();
  };

  public unsubscribeReports = () => {
    console.log("Unsubscribing Reports");
    let messageId = this.messageId++;
    this.send({
      method: "unsubscribeReports",
      params: {},
      id: messageId,
    });
    this.reportsCallback = undefined;
    this.callbackMap.remove(this.reportsCallbackId);
  };

  // Public NonKYC Websocket API calls

  public getAsset = async (ticker: string): Promise<NonKYCAsset> => {
    let messageId = this.messageId++;
    this.send({
      method: "getAsset",
      params: {
        ticker: ticker,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCAsset;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getAssets = async (): Promise<NonKYCAsset[]> => {
    let messageId = this.messageId++;
    this.send({
      method: "getAssets",
      params: {},
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCAsset[];
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getMarket = async (symbol: string): Promise<NonKYCMarket> => {
    let messageId = this.messageId++;
    this.send({
      method: "getMarket",
      params: {
        symbol: symbol,
      },
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCMarket;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getMarkets = async (): Promise<NonKYCMarket[]> => {
    let messageId = this.messageId++;
    this.send({
      method: "getMarkets",
      params: {},
      id: messageId,
    });
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as NonKYCMarket[];
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public getTrades = (
    symbol: string,
    callback: (response: NonKYCResponse) => void,
    limit: number = 100,
    offset: number = 0,
    sort: string | null = null,
    from: string | null = null,
    till: string | null = null
  ) => {
    let messageId = this.messageId++;
    this.send({
      method: "getTrades",
      params: {
        symbol: symbol,
        limit: limit,
        offset: offset,
        sort: sort,
        from: from,
        till: till,
      },
      id: messageId,
    });
    this.callbackMap.add(messageId, callback);
  };

  public subscribeTicker = async (symbol: string, callback: (response: NonKYCResponse) => void) => {
    console.log("Subscribing Ticker");
    await waitToBlock();
    let symbolCallback = this.symbolCallbacks.filter((scb) => scb.symbol === symbol)[0];
    let symbols = this.symbolCallbacks.length + 1;
    if (!symbolCallback) {
      symbolCallback = {
        symbol: symbol,
        tickerCallbackId: symbols * 4 + 1,
        orderbookCallbackId: symbols * 4 + 2,
        tradesCallbackId: symbols * 4 + 3,
        candlesCallbackId: symbols * 4 + 4,
      };
      this.symbolCallbacks.push(symbolCallback);
    }
    this.send({
      method: "subscribeTicker",
      params: { symbol },
      id: symbolCallback.tickerCallbackId,
    });
    this.subscriptions.push({ symbol, tickerCallback: callback });
    this.callbackMap.add(symbolCallback.tickerCallbackId, callback);
    await unBlock();
  };

  // Update unsubscribe methods to remove from subscriptions
  public unsubscribeTicker = async (symbol: string): Promise<boolean> => {
    console.log("Unsubscribing Tickers");
    let messageId = this.messageId++;
    this.send({
      method: "unsubscribeTicker",
      params: { symbol },
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.symbol !== symbol || !sub.tickerCallback);
    this.symbolCallbacks = this.symbolCallbacks.filter((scb) => scb.symbol !== symbol);
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as boolean;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public subscribeOrderbook = async (symbol: string, callback: (response: NonKYCResponse) => void) => {
    console.log("Subscribing Orderbook");
    await waitToBlock();
    let symbolCallback = this.symbolCallbacks.filter((scb) => scb.symbol === symbol)[0];
    let symbols = this.symbolCallbacks.length + 1;
    if (!symbolCallback) {
      symbolCallback = {
        symbol: symbol,
        tickerCallbackId: symbols * 4 + 1,
        orderbookCallbackId: symbols * 4 + 2,
        tradesCallbackId: symbols * 4 + 3,
        candlesCallbackId: symbols * 4 + 4,
      };
      this.symbolCallbacks.push(symbolCallback);
    }
    this.send({
      method: "subscribeOrderbook",
      params: { symbol },
      id: symbolCallback.orderbookCallbackId,
    });
    this.subscriptions.push({ symbol, orderbookCallback: callback });
    this.callbackMap.add(symbolCallback.orderbookCallbackId, callback);
    await unBlock();
  };

  public unsubscribeOrderbook = async (symbol: string): Promise<boolean> => {
    console.log("Unsubscribing Orderbooks");
    let messageId = this.messageId++;
    this.send({
      method: "unsubscribeOrderbook",
      params: { symbol },
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.symbol !== symbol || !sub.orderbookCallback);
    this.symbolCallbacks = this.symbolCallbacks.filter((scb) => scb.symbol !== symbol);
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as boolean;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public subscribeTrades = async (symbol: string, callback: (response: NonKYCResponse) => void) => {
    console.log("Subscribing Trades");
    await waitToBlock();
    let symbolCallback = this.symbolCallbacks.filter((scb) => scb.symbol === symbol)[0];
    let symbols = this.symbolCallbacks.length + 1;
    if (!symbolCallback) {
      symbolCallback = {
        symbol: symbol,
        tickerCallbackId: symbols * 4 + 1,
        orderbookCallbackId: symbols * 4 + 2,
        tradesCallbackId: symbols * 4 + 3,
        candlesCallbackId: symbols * 4 + 4,
      };
      this.symbolCallbacks.push(symbolCallback);
    }
    this.send({
      method: "subscribeTrades",
      params: { symbol },
      id: symbolCallback.tradesCallbackId,
    });
    this.subscriptions.push({ symbol, tradesCallback: callback });
    this.callbackMap.add(symbolCallback.tradesCallbackId, callback);
    await unBlock();
  };

  public unsubscribeTrades = async (symbol: string): Promise<boolean> => {
    console.log("Unsubscribing Trades");
    let messageId = this.messageId++;
    this.send({
      method: "unsubscribeTrades",
      params: { symbol },
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.symbol !== symbol || !sub.tradesCallback);
    this.symbolCallbacks = this.symbolCallbacks.filter((scb) => scb.symbol !== symbol);
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as boolean;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  public subscribeCandles = async (
    symbol: string,
    period: number,
    callback: (response: NonKYCResponse) => void,
    limit: number = 100
  ) => {
    console.log("Subscribing Candles");
    await waitToBlock();
    let symbolCallback = this.symbolCallbacks.filter((scb) => scb.symbol === symbol)[0];
    let symbols = this.symbolCallbacks.length + 1;
    if (!symbolCallback) {
      symbolCallback = {
        symbol: symbol,
        tickerCallbackId: symbols * 4 + 1,
        orderbookCallbackId: symbols * 4 + 2,
        tradesCallbackId: symbols * 4 + 3,
        candlesCallbackId: symbols * 4 + 4,
      };
      this.symbolCallbacks.push(symbolCallback);
    }
    this.send({
      method: "subscribeCandles",
      params: { symbol, period, limit },
      id: symbolCallback.candlesCallbackId,
    });
    this.subscriptions.push({ symbol, candlesCallback: callback, candlesPeriod: period, candlesLimit: limit });
    this.callbackMap.add(symbolCallback.candlesCallbackId, callback);
    await unBlock();
  };

  public unsubscribeCandles = async (symbol: string, period: number): Promise<boolean> => {
    console.log("Unsubscribing Candles");
    let messageId = this.messageId++;
    this.send({
      method: "unsubscribeCandles",
      params: { symbol, period },
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.symbol !== symbol || !sub.candlesCallback);
    this.symbolCallbacks = this.symbolCallbacks.filter((scb) => scb.symbol !== symbol);
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: NonKYCResponse) => {
        const result = response.result as boolean;
        if (result) {
          resolve(result);
        } else {
          reject(response.error);
        }
      });
    });
  };

  // NonKYC REST API calls

  private apiCall = async (route: string, method: string, body: object, params: urlParams): Promise<any> => {
    let uri = `${this.ApiURL}${route}`;
    const maxRetries = 6;
    const retryDelay = 1000; // 1 second delay between retries

    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          value.forEach((v) => queryString.append(key, v));
        } else {
          queryString.append(key, value);
        }
      }
      uri += `?${queryString.toString()}`;
      const url = new URL(uri);

      let attempts = 0;
      while (attempts < maxRetries) {
        try {
          const response = await fetch(url, {
            method: method,
            headers: {
              Authorization: "Basic " + Buffer.from(this.key + ":" + this.secret).toString("base64"),
              "Content-Type": "application/json",
            },
          });
          // logToFile("./logs/apicalls-NonKYC.log", `API CALL ${method}: ${url} ${JSON.stringify(body)}`);
          if (!response.ok) {
            logToFile("./logs/error.log", JSON.stringify(response.status));
          }
          return await response.json();
        } catch (error) {
          logToFile("./logs/error.log", error.message); // Log network or other errors
          attempts++;
          if (attempts >= maxRetries) {
            throw error;
          }
          await delay(retryDelay);
        }
      }
    } else {
      const url = new URL(uri);
      if (method === "GET" || method === "HEAD") {
        let attempts = 0;
        while (attempts < maxRetries) {
          try {
            const response = await fetch(url, {
              method: method,
              headers: {
                Authorization: "Basic " + Buffer.from(this.key + ":" + this.secret).toString("base64"),
                "Content-Type": "application/json",
              },
            });
            // logToFile("./logs/apicalls-NonKYC.log", `API CALL ${method}: ${url} ${JSON.stringify(body)}`);
            if (!response.ok) {
              logToFile("./logs/error.log", JSON.stringify(response.status));
              throw new Error(`API call failed with status ${response.status}`);
            }
            return await response.json();
          } catch (error) {
            logToFile("./logs/error.log", error.message); // Log network or other errors
            attempts++;
            if (attempts >= maxRetries) {
              throw error;
            }
            await delay(retryDelay);
          }
        }
      } else {
        let attempts = 0;
        while (attempts < maxRetries) {
          try {
            const response = await fetch(url, {
              method: method,
              headers: {
                Authorization: "Basic " + Buffer.from(this.key + ":" + this.secret).toString("base64"),
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            });
            // logToFile("./logs/apicalls-NonKYC.log", `API CALL ${method}: ${url} ${JSON.stringify(body)}`);
            if (!response.ok) {
              logToFile("./logs/error.log", JSON.stringify(response.status));
              throw new Error(`API call failed with status ${response.status}`);
            }
            return await response.json();
          } catch (error) {
            logToFile("./logs/error.log", error.message); // Log network or other errors
            attempts++;
            if (attempts >= maxRetries) {
              throw error;
            }
            await delay(retryDelay);
          }
        }
      }
    }
  };

  // Public API calls

  public getAssetList = async () => {
    return this.apiCall("/asset/getlist", "GET", {}, {});
  };

  public getAssetByID = async (id: string) => {
    return this.apiCall(`/asset/getbyid/${id}`, "GET", {}, {});
  };

  public getAssetByTicker = async (ticker: string) => {
    return this.apiCall(`/asset/getbyticker/${ticker}`, "GET", {}, {});
  };

  public getMarketList = async () => {
    return this.apiCall("/market/getlist", "GET", {}, {});
  };

  public getMarketByID = async (id: string) => {
    return this.apiCall(`/market/getbyid/${id}`, "GET", {}, {});
  };

  public getMarketBySymbol = async (symbol: string) => {
    return this.apiCall(`/market/getbysymbol/${symbol}`, "GET", {}, {});
  };

  public getPoolList = async () => {
    return this.apiCall("/pool/getlist", "GET", {}, {});
  };

  public getPoolByID = async (id: string) => {
    return this.apiCall(`/pool/getbyid/${id}`, "GET", {}, {});
  };

  public getPoolBySymbol = async (symbol: string) => {
    return this.apiCall(`/pool/getbysymbol/${symbol}`, "GET", {}, {});
  };

  public getOrderbookBySymbol = async (symbol: string) => {
    return this.apiCall(`/market/getorderbookbysymbol/${symbol}`, "GET", {}, {});
  };

  public getOrderbookByMarketID = async (id: string) => {
    return this.apiCall(`/market/getorderbookbymarketid/${id}`, "GET", {}, {});
  };

  public getCandles = async (
    symbol: string,
    from: number | null,
    to: number | null,
    resolution: number,
    countBack: number,
    firstDataRequest: number
  ) => {
    if (from === null && to === null) {
      return this.apiCall(
        `/market/candles`,
        "GET",
        {},
        {
          symbol: symbol,
          resolution: resolution?.toString()!,
          countBack: countBack?.toString()!,
          firstDataRequest: firstDataRequest?.toString()!,
        }
      );
    } else {
      return this.apiCall(
        `/market/candles`,
        "GET",
        {},
        {
          symbol: symbol,
          from: from?.toString()!,
          to: to?.toString()!,
          resolution: resolution?.toString()!,
          countBack: countBack?.toString()!,
          firstDataRequest: firstDataRequest?.toString()!,
        }
      );
    }
  };

  // Aggregator API calls

  public getInfo = async () => {
    return this.apiCall("/info", "GET", {}, {});
  };

  public getSummary = async () => {
    return this.apiCall("/summary", "GET", {}, {});
  };

  public getAllCmcAssets = async () => {
    return this.apiCall("/cmcassets", "GET", {}, {});
  };

  public getAllCmcTickers = async () => {
    return this.apiCall("/cmctickers", "GET", {}, {});
  };

  public getCmcOrderookSymbol = async (symbol: string) => {
    return this.apiCall(`/cmcorderbook/${symbol}`, "GET", {}, {});
  };

  public getCmcTradesBySymbol = async (symbol: string) => {
    return this.apiCall(`/cmctrades/${symbol}`, "GET", {}, {});
  };

  public getAllMarkets = async (type: string) => {
    return this.apiCall(
      `/markets`,
      "GET",
      {},
      {
        type: type,
      }
    );
  };

  // public getAllTrades = async (market: string, since: string) => {
  //   return this.apiCall(`/trades/${market}/${since}`, "GET", {}, {});
  // }

  public getAllOrderSnapshots = async (market: string) => {
    return this.apiCall(
      `/order/snapshots`,
      "GET",
      {},
      {
        market: market,
      }
    );
  };

  public getAllPairs = async () => {
    return this.apiCall("/pairs", "GET", {}, {});
  };

  public getTickerBySymbol = async (symbol: string) => {
    return this.apiCall(`/ticker/${symbol}`, "GET", {}, {});
  };

  public getAllTickers = async () => {
    return this.apiCall("/tickers", "GET", {}, {});
  };

  public getOrderbook = async (ticker: string, depth: string) => {
    return this.apiCall(
      `/orderbook`,
      "GET",
      {},
      {
        ticker_id: ticker,
        depth: depth,
      }
    );
  };

  public getAllHistoricalTrades = async (ticker: string, limit: string) => {
    return this.apiCall(
      `/historical_trades`,
      "GET",
      {},
      {
        ticker_id: ticker,
        limit: limit,
      }
    );
  };

  public getAllHistoricalPoolTrades = async (ticker: string, limit: string) => {
    return this.apiCall(
      `/historical_pooltrades`,
      "GET",
      {},
      {
        ticker_id: ticker,
        limit: limit,
      }
    );
  };

  // Account API calls

  public getBalances = async () => {
    return this.apiCall("/balances", "GET", {}, {});
  };

  public getDepositoAddress = async (ticker: string) => {
    return this.apiCall(`/getdepositaddress/${ticker}`, "GET", {}, {});
  };

  public createOrder = async (symbol: string, side: string, type: string, quantity: string, price: string) => {
    return this.apiCall(
      `/createorder/`,
      "POST",
      {
        symbol: symbol,
        side: side,
        type: type,
        quantity: quantity,
        price: price,
      },
      {}
    );
  };

  public cancelOrderByID = async (id: string) => {
    return this.apiCall(
      `/cancelorder/`,
      "POST",
      {
        id: id,
      },
      {}
    );
  };

  public cancelAllOrders = async (symbol: string, side: string) => {
    return this.apiCall(
      `/cancelallorders/`,
      "POST",
      {
        symbol: symbol,
        side: side,
      },
      {}
    );
  };

  public createWithdrawal = async (ticker: string, quantity: string, address: string, paymentid: string) => {
    return this.apiCall(
      `/cancelallorders/`,
      "POST",
      {
        ticker: ticker,
        quantity: quantity,
        address: address,
        paymentid: paymentid,
      },
      {}
    );
  };

  public getAllDeposits = async (ticker: string, limit: string, skip: string) => {
    return this.apiCall(
      `/getdeposits`,
      "GET",
      {},
      {
        ticker_id: ticker,
        limit: limit,
        skip: skip,
      }
    );
  };

  public getAllWithdrawals = async (ticker: string, limit: string, skip: string) => {
    return this.apiCall(
      `/getwitrdawals`,
      "GET",
      {},
      {
        ticker_id: ticker,
        limit: limit,
        skip: skip,
      }
    );
  };

  public getOrderByID = async (id: string) => {
    return this.apiCall(`/getorder/${id}`, "GET", {}, {});
  };

  public getAllOrders = async (symbol: string, status: string, limit: number, skip: number) => {
    return this.apiCall(
      `/getorders`,
      "GET",
      {},
      {
        symbol: symbol,
        status: status,
        limit: limit.toString(),
        skip: skip.toString(),
      }
    );
  };

  public getAllTrades = async (symbol: string, limit: number, skip: number) => {
    return this.apiCall(
      `/gettrades`,
      "GET",
      {},
      {
        symbol: symbol,
        limit: limit.toString(),
        skip: skip.toString(),
      }
    );
  };

  public getAllTradesSince = async (symbol: string, since: string, limit: number, skip: number) => {
    return this.apiCall(
      `/gettradessince`,
      "GET",
      {},
      {
        symbol: symbol,
        since: since,
        limit: limit.toString(),
        skip: skip.toString(),
      }
    );
  };

  public getAllPoolTrades = async (symbol: string, limit: number, skip: number) => {
    return this.apiCall(
      `/getpooltrades`,
      "GET",
      {},
      {
        symbol: symbol,
        limit: limit.toString(),
        skip: skip.toString(),
      }
    );
  };

  public getPoolTradesSince = async (symbol: string, since: string, limit: number, skip: number) => {
    return this.apiCall(
      `/getpooltradessince`,
      "GET",
      {},
      {
        symbol: symbol,
        since: since,
        limit: limit.toString(),
        skip: skip.toString(),
      }
    );
  };
}
