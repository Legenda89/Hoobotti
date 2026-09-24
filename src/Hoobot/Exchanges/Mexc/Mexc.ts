import crypto from "crypto";
import EventEmitter from "events";
import WebSocket from "ws";
import { logToFile } from "../../Utilities/LogToFile";
import { URL } from "url";

interface urlParams {
  [key: string]: string | string[];
}

export interface MexcOptions {
  wssHost?: string;
  key?: string;
  secret?: string;
}

export interface MexcError {
  code: number;
  msg: string;
}

export interface MexcResponse {
  id?: number;
  code?: number;
  msg?: string;
  channel?: string;
  symbol?: string;
  sendtime?: number;
  publicdeals?: MexcTradeData;
  publicspotkline?: MexcKlineData;
  publicincreasedepths?: MexcDepthData;
  publiclimitdepths?: MexcDepthData;
  publicbookticker?: MexcBookTickerData;
  publicBookTickerBatch?: MexcBookTickerBatchData;
}

export interface MexcTradeData {
  dealsList: MexcTrade[];
  eventtype: string;
}

export interface MexcTrade {
  price: string;
  quantity: string;
  tradetype: number; // 1: Buy, 2: Sell
  time: number;
}

export interface MexcKlineData {
  interval: string;
  windowstart: number;
  openingprice: string;
  closingprice: string;
  highestprice: string;
  lowestprice: string;
  volume: string;
  amount: string;
  windowend: number;
}

export interface MexcDepthData {
  asksList: MexcOrder[];
  bidsList: MexcOrder[];
  eventtype: string;
  version: string;
}

export interface MexcOrder {
  price: string;
  quantity: string;
}

export interface MexcBookTickerData {
  bidprice: string;
  bidquantity: string;
  askprice: string;
  askquantity: string;
}

export interface MexcBookTickerBatchData {
  items: MexcBookTickerData[];
}

export interface MexcBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface MexcOrder {
  symbol: string;
  orderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
}

const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

var MexcBlocked: boolean = false;

const waitToBlock = async () => {
  while (MexcBlocked === true) {
    await delay(5);
  }
  MexcBlocked = true;
};

const unBlock = async () => {
  MexcBlocked = false;
};

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

interface Subscription {
  symbol: string;
  channel: string;
  callback: (response: MexcResponse) => void;
}

export class Mexc {
  private readonly WebSocketURL: string;
  private readonly ApiURL: string;
  private key?: string;
  private secret?: string;
  private messageId: number = 500000;
  private ws: WebSocket | null = null;
  private keepAlive: NodeJS.Timeout | undefined;
  private pingTimeout: NodeJS.Timeout | undefined;
  private subscriptions: Subscription[] = [];
  private callbackMap: CallbackMap;
  private emitter: EventEmitter;
  private forceStopOnDisconnect: boolean;
  private maxReconnectionAttempts: number = 5;

  constructor(options: MexcOptions) {
    this.WebSocketURL = options.wssHost || "wss://wbs-api.mexc.com/ws";
    this.ApiURL = "https://api.mexc.com/api/v3";
    this.key = options.key;
    this.secret = options.secret;
    this.callbackMap = new CallbackMap();
    this.emitter = new EventEmitter();
    this.forceStopOnDisconnect = false;
    this.connect();
  }

  private heartBeat = () => {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }
    this.pingTimeout = setTimeout(() => {
      if (this.ws) {
        console.warn("Ping timeout. Terminating WebSocket...");
        this.ws.terminate();
        this.ws = null;
      }
    }, 70000);
  };

  private loopPing = () => {
    if (this.keepAlive) {
      clearTimeout(this.keepAlive);
    }
    this.keepAlive = setTimeout(() => {
      this.send({ method: "PING" });
      this.loopPing();
    }, 20000);
  };

  public waitConnect = () => {
    return new Promise((resolve) => {
      this.emitter.on("connected", () => {
        resolve(true);
      });
    });
  };

  private connect = async (): Promise<WebSocket> => {
    this.ws = new WebSocket(this.WebSocketURL);

    this.ws.on("open", async () => {
      console.log("MEXC WebSocket connected.");
      this.loopPing();
      this.emitter.emit("connected");
    });

    this.ws.on("close", async (code: number) => {
      clearTimeout(this.pingTimeout);
      clearTimeout(this.keepAlive);
      console.log(`MEXC WebSocket closed with code ${code}.`);
      if (!this.forceStopOnDisconnect && code === 1006) {
        console.log("WebSocket closed abnormally (1006). Attempting to reconnect...");
        await delay(1000);
        this.connect();
      }
    });

    this.ws.on("error", (err) => {
      console.error("MEXC WebSocket encountered an error:", err);
      this.emitter.emit("websocket_error", err);
    });

    this.ws.on("ping", () => {
      this.heartBeat();
    });

    this.ws.on("pong", () => {
      this.heartBeat();
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
        console.log("MEXC disconnected.");
      }
    } catch (err) {
      console.error("Error during disconnect:", err);
    }
  }

  private send = (message: any): void => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error("MEXC WebSocket connection not established");
    }
  };

  private onMessage = (event: WebSocket.MessageEvent): void => {
    if (!this.ws) {
      console.error("MEXC WebSocket connection not established");
      throw new Error("MEXC WebSocket connection not established");
    }
    const response: MexcResponse = JSON.parse(event.data.toString("utf-8"));
    if (response.code !== undefined && response.code !== 0) {
      console.error(`Message error: ${JSON.stringify(response, null, 4)}`);
    }
    if (response.id !== undefined) {
      this.emitter.emit(`response_${response.id}`, response);
    } else {
      const subscription = this.subscriptions.find((sub) => sub.channel === response.channel);
      if (subscription) {
        subscription.callback(response);
      }
    }
  };

  // WebSocket Subscription Methods

  public subscribeTrades = async (
    symbol: string,
    interval: "10ms" | "100ms",
    callback: (response: MexcResponse) => void
  ) => {
    await waitToBlock();
    const channel = `spot@public.aggre.deals.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeTrades = async (symbol: string, interval: "10ms" | "100ms") => {
    await waitToBlock();
    const channel = `spot@public.aggre.deals.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public subscribeKlines = async (symbol: string, interval: string, callback: (response: MexcResponse) => void) => {
    await waitToBlock();
    const channel = `spot@public.kline.v3.api.pb@${symbol.toUpperCase()}@${interval}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeKlines = async (symbol: string, interval: string) => {
    await waitToBlock();
    const channel = `spot@public.kline.v3.api.pb@${symbol.toUpperCase()}@${interval}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public subscribeDepth = async (
    symbol: string,
    interval: "10ms" | "100ms",
    callback: (response: MexcResponse) => void
  ) => {
    await waitToBlock();
    const channel = `spot@public.aggre.depth.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeDepth = async (symbol: string, interval: "10ms" | "100ms") => {
    await waitToBlock();
    const channel = `spot@public.aggre.depth.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public subscribeLimitDepth = async (
    symbol: string,
    level: 5 | 10 | 20,
    callback: (response: MexcResponse) => void
  ) => {
    await waitToBlock();
    const channel = `spot@public.limit.depth.v3.api.pb@${symbol.toUpperCase()}@${level}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeLimitDepth = async (symbol: string, level: 5 | 10 | 20) => {
    await waitToBlock();
    const channel = `spot@public.limit.depth.v3.api.pb@${symbol.toUpperCase()}@${level}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public subscribeBookTicker = async (
    symbol: string,
    interval: "10ms" | "100ms",
    callback: (response: MexcResponse) => void
  ) => {
    await waitToBlock();
    const channel = `spot@public.aggre.bookTicker.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeBookTicker = async (symbol: string, interval: "10ms" | "100ms") => {
    await waitToBlock();
    const channel = `spot@public.aggre.bookTicker.v3.api.pb@${interval}@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public subscribeBookTickerBatch = async (symbol: string, callback: (response: MexcResponse) => void) => {
    await waitToBlock();
    const channel = `spot@public.bookTicker.batch.v3.api.pb@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "SUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions.push({ symbol, channel, callback });
    this.callbackMap.add(messageId, callback);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  public unsubscribeBookTickerBatch = async (symbol: string) => {
    await waitToBlock();
    const channel = `spot@public.bookTicker.batch.v3.api.pb@${symbol.toUpperCase()}`;
    const messageId = this.messageId++;
    this.send({
      method: "UNSUBSCRIPTION",
      params: [channel],
      id: messageId,
    });
    this.subscriptions = this.subscriptions.filter((sub) => sub.channel !== channel);
    this.callbackMap.remove(messageId);
    await unBlock();
    return new Promise((resolve, reject) => {
      this.emitter.on(`response_${messageId}`, (response: MexcResponse) => {
        if (response.code === 0) {
          resolve(true);
        } else {
          reject(response);
        }
      });
    });
  };

  // REST API Methods

  private apiCall = async (route: string, method: string, body: object = {}, params: urlParams = {}): Promise<any> => {
    let uri = `${this.ApiURL}${route}`;
    try {
      let queryStringForSign = "";
      if (Object.keys(params).length > 0) {
        const queryString = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (Array.isArray(value)) {
            value.forEach((v) => queryString.append(key, v));
          } else {
            queryString.append(key, value);
          }
        }
        uri += `?${queryString.toString()}`;
        queryStringForSign = queryString.toString();
      }
      const url = new URL(uri);
      const headers: { [key: string]: string } = {
        "Content-Type": "application/json",
      };
      let signaturePayload = "";
      if (this.key && this.secret) {
        const timestamp = Date.now().toString();
        headers["X-MEXC-APIKEY"] = this.key;
        headers["X-MEXC-TIMESTAMP"] = timestamp;
        if (method === "POST" || method === "DELETE") {
          signaturePayload = JSON.stringify(body);
        } else {
          signaturePayload = queryStringForSign;
        }
        const signature = crypto
          .createHmac("sha256", this.secret)
          .update(`${this.key}${timestamp}${route}${signaturePayload ? `?${signaturePayload}` : ""}`)
          .digest("hex");
        headers["X-MEXC-SIGNATURE"] = signature;
      }
      const response = await fetch(url, {
        method,
        headers,
        body: method !== "GET" && method !== "HEAD" ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        logToFile("./logs/error.log", JSON.stringify(response.status));
        throw new Error(`MEXC API call failed with status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logToFile("./logs/error.log", JSON.stringify(error, null, 4));
      console.error(`Error fetching ${uri} :`, error);
      throw error;
    }
  };

  // Public Market Data Endpoints[](https://www.mexc.com/api-docs/spot-v3/market-data-endpoints)

  public testConnectivity = async () => {
    return this.apiCall("/ping", "GET", {}, {});
  };

  public getServerTime = async () => {
    return this.apiCall("/time", "GET", {}, {});
  };

  public getExchangeInfo = async (symbol?: string, symbols?: string[]) => {
    const params: urlParams = {};
    if (symbol) params.symbol = symbol.toUpperCase();
    if (symbols) params.symbols = symbols.map((s) => s.toUpperCase());
    return this.apiCall("/exchangeInfo", "GET", {}, params);
  };

  public getDepthSnapshot = async (symbol: string, limit: number = 1000) => {
    return this.apiCall("/depth", "GET", {}, { symbol: symbol.toUpperCase(), limit: limit.toString() });
  };

  public getTrades = async (symbol: string, limit: number = 500) => {
    return this.apiCall("/trades", "GET", {}, { symbol: symbol.toUpperCase(), limit: limit.toString() });
  };

  public getHistoricalTrades = async (symbol: string, limit: number = 500, fromId?: string) => {
    const params: urlParams = { symbol: symbol.toUpperCase(), limit: limit.toString() };
    if (fromId) params.fromId = fromId;
    return this.apiCall("/historicalTrades", "GET", {}, params);
  };

  public getAggTrades = async (
    symbol: string,
    fromId?: string,
    startTime?: number,
    endTime?: number,
    limit: number = 500
  ) => {
    const params: urlParams = { symbol: symbol.toUpperCase(), limit: limit.toString() };
    if (fromId) params.fromId = fromId;
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/aggTrades", "GET", {}, params);
  };

  public getKlines = async (
    symbol: string,
    interval: string,
    startTime?: number,
    endTime?: number,
    limit: number = 500
  ) => {
    const params: urlParams = { symbol: symbol.toUpperCase(), interval, limit: limit.toString() };
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/klines", "GET", {}, params);
  };

  public getAvgPrice = async (symbol: string) => {
    return this.apiCall("/avgPrice", "GET", {}, { symbol: symbol.toUpperCase() });
  };

  public getAllTickers = async () => {
    return this.apiCall("/ticker/24hr", "GET", {}, {});
  };

  public getTickerBySymbol = async (symbol: string) => {
    return this.apiCall("/ticker/24hr", "GET", {}, { symbol: symbol.toUpperCase() });
  };

  public getTickerPrice = async (symbol?: string, symbols?: string[]) => {
    const params: urlParams = {};
    if (symbol) params.symbol = symbol.toUpperCase();
    if (symbols) params.symbols = symbols.map((s) => s.toUpperCase());
    return this.apiCall("/ticker/price", "GET", {}, params);
  };

  public getBookTicker = async (symbol?: string, symbols?: string[]) => {
    const params: urlParams = {};
    if (symbol) params.symbol = symbol.toUpperCase();
    if (symbols) params.symbols = symbols.map((s) => s.toUpperCase());
    return this.apiCall("/ticker/bookTicker", "GET", {}, params);
  };

  // Account and Trading Endpoints (Require Authentication)[](https://www.mexc.com/api-docs/futures/account-and-trading-endpoints)

  public getBalances = async () => {
    return this.apiCall("/account", "GET", {}, {});
  };

  public createOrder = async (
    symbol: string,
    side: "BUY" | "SELL",
    type: "LIMIT" | "MARKET" | "LIMIT_MAKER",
    quantity: string,
    price?: string,
    newClientOrderId?: string,
    recvWindow: number = 5000
  ) => {
    const params: any = { symbol: symbol.toUpperCase(), side, type, quantity, recvWindow: recvWindow.toString() };
    if (price) params.price = price;
    if (newClientOrderId) params.newClientOrderId = newClientOrderId;
    return this.apiCall("/order", "POST", params, {});
  };

  public cancelOrder = async (
    symbol: string,
    orderId?: string,
    origClientOrderId?: string,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = { symbol: symbol.toUpperCase(), recvWindow: recvWindow.toString() };
    if (orderId) params.orderId = orderId;
    if (origClientOrderId) params.origClientOrderId = origClientOrderId;
    return this.apiCall("/order", "DELETE", {}, params);
  };

  public cancelAllOrders = async (symbol: string, recvWindow: number = 5000) => {
    return this.apiCall(
      "/openOrders",
      "DELETE",
      {},
      { symbol: symbol.toUpperCase(), recvWindow: recvWindow.toString() }
    );
  };

  public getOrders = async (
    symbol: string,
    orderId?: string,
    startTime?: number,
    endTime?: number,
    limit: number = 500,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = {
      symbol: symbol.toUpperCase(),
      limit: limit.toString(),
      recvWindow: recvWindow.toString(),
    };
    if (orderId) params.orderId = orderId;
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/openOrders", "GET", {}, params);
  };

  public getAllOrders = async (
    symbol: string,
    orderId?: string,
    startTime?: number,
    endTime?: number,
    limit: number = 500,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = {
      symbol: symbol.toUpperCase(),
      limit: limit.toString(),
      recvWindow: recvWindow.toString(),
    };
    if (orderId) params.orderId = orderId;
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/allOrders", "GET", {}, params);
  };

  public getOrder = async (symbol: string, orderId?: string, origClientOrderId?: string, recvWindow: number = 5000) => {
    const params: urlParams = { symbol: symbol.toUpperCase(), recvWindow: recvWindow.toString() };
    if (orderId) params.orderId = orderId;
    if (origClientOrderId) params.origClientOrderId = origClientOrderId;
    return this.apiCall("/order", "GET", {}, params);
  };

  public getAccountTrades = async (
    symbol: string,
    startTime?: number,
    endTime?: number,
    fromId?: string,
    limit: number = 500,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = {
      symbol: symbol.toUpperCase(),
      limit: limit.toString(),
      recvWindow: recvWindow.toString(),
    };
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    if (fromId) params.fromId = fromId;
    return this.apiCall("/myTrades", "GET", {}, params);
  };

  public getDepositAddress = async (coin: string, network?: string, recvWindow: number = 5000) => {
    const params: urlParams = { coin, recvWindow: recvWindow.toString() };
    if (network) params.network = network;
    return this.apiCall("/capital/deposit/address", "GET", {}, params);
  };

  public createWithdrawal = async (
    coin: string,
    address: string,
    amount: string,
    network?: string,
    memo?: string,
    remark?: string,
    recvWindow: number = 5000
  ) => {
    const params: any = { coin, address, amount, recvWindow: recvWindow.toString() };
    if (network) params.network = network;
    if (memo) params.memo = memo;
    if (remark) params.remark = remark;
    return this.apiCall("/capital/withdraw/apply", "POST", params, {});
  };

  public cancelWithdrawal = async (withdrawId: string, recvWindow: number = 5000) => {
    return this.apiCall("/capital/withdraw/cancel", "POST", { id: withdrawId, recvWindow: recvWindow.toString() }, {});
  };

  public getDepositHistory = async (
    coin?: string,
    status?: string,
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = { limit: limit.toString(), recvWindow: recvWindow.toString() };
    if (coin) params.coin = coin;
    if (status) params.status = status;
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/capital/deposit/hisrec", "GET", {}, params);
  };

  public getWithdrawalHistory = async (
    coin?: string,
    status?: string,
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = { limit: limit.toString(), recvWindow: recvWindow.toString() };
    if (coin) params.coin = coin;
    if (status) params.status = status;
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/capital/withdraw/hisrec", "GET", {}, params);
  };

  public getDefaultSymbol = async (recvWindow: number = 5000) => {
    return this.apiCall("/defaultSymbols", "GET", {}, { recvWindow: recvWindow.toString() });
  };

  public getInternalTransferHistory = async (
    startTime?: number,
    endTime?: number,
    limit: number = 100,
    recvWindow: number = 5000
  ) => {
    const params: urlParams = { limit: limit.toString(), recvWindow: recvWindow.toString() };
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();
    return this.apiCall("/capital/transfer/hisrec", "GET", {}, params);
  };

  public createInternalTransfer = async (
    fromAccountType: string,
    toAccountType: string,
    asset: string,
    amount: string,
    recvWindow: number = 5000
  ) => {
    return this.apiCall(
      "/capital/transfer",
      "POST",
      {
        fromAccountType,
        toAccountType,
        asset,
        amount,
        recvWindow: recvWindow.toString(),
      },
      {}
    );
  };

  public getCurrencyInfo = async (coin?: string, network?: string) => {
    const params: urlParams = {};
    if (coin) params.coin = coin;
    if (network) params.network = network;
    return this.apiCall("/capital/config/getall", "GET", {}, params);
  };
}
