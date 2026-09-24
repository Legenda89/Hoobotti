/* simulateListenForCandlesticks: flush (≤250) ja stopTrading -polut. */

import { simulateListenForCandlesticks, type Candlestick } from "./Candlesticks";
import type { ConfigOptions } from "../Utilities/Args";

function mkCandle(i: number): Candlestick {
  return {
    symbol: "BTCUSDT",
    interval: "1h",
    type: "k",
    time: i,
    startTime: i,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    trades: 0,
    volume: 1,
    quoteVolume: 1,
    buyVolume: 0,
    quoteBuyVolume: 0,
    isFinal: true,
  };
}

function baseOpts(): ConfigOptions {
  return {
    running: false,
    debug: false,
    startTime: "",
    exchanges: [],
    license: "",
    simulate: true,
    discord: {},
  };
}

const progress = { passIndex: 1, passTotal: 1, focusSymbol: "BTC/USDT" };

describe("simulateListenForCandlesticks", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("flush: yksi callback kun sarja jää 100 kynttilään (ei ylitä 250:aa)", async () => {
    const cb = jest.fn(async () => {});
    const candles = Array.from({ length: 100 }, (_, i) => mkCandle(i));
    const store = {};
    const out = await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      baseOpts(),
      cb,
      progress,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(cb).toHaveBeenCalledTimes(1);
    expect(out.userAborted).toBe(false);
    expect(out.stopTradingHalted).toBeUndefined();
    expect(store as Record<string, Record<string, Candlestick[]>>).toMatchObject({
      BTCUSDT: { "1h": expect.any(Array) },
    });
    expect((store as Record<string, Record<string, Candlestick[]>>).BTCUSDT["1h"]).toHaveLength(100);
  });

  it("251 kynttilää: yksi callback silmukasta, flush ei tuplaa", async () => {
    const cb = jest.fn(async () => {});
    const candles = Array.from({ length: 251 }, (_, i) => mkCandle(i));
    const store = {};
    const out = await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      baseOpts(),
      cb,
      progress,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(cb).toHaveBeenCalledTimes(1);
    expect(out.stopTradingHalted).toBeUndefined();
  });

  it("260 kynttilää: callback jokaisella askeleella 251→260 (10 kutsua), ei flush-tuplaa", async () => {
    const cb = jest.fn(async () => {});
    const candles = Array.from({ length: 260 }, (_, i) => mkCandle(i));
    const store = {};
    await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      baseOpts(),
      cb,
      progress,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(cb).toHaveBeenCalledTimes(10);
  });

  it("isStopTrading: pysähtyy ennen toista >250-callbackia", async () => {
    let armed = false;
    const cb = jest.fn(async () => {
      armed = true;
    });
    const candles = Array.from({ length: 280 }, (_, i) => mkCandle(i));
    const store = {};
    const out = await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      baseOpts(),
      cb,
      progress,
      undefined,
      undefined,
      undefined,
      () => armed
    );
    expect(cb).toHaveBeenCalledTimes(1);
    expect(out.stopTradingHalted).toBe(true);
    expect(out.stopTradingAtCandleIndex).toBe(252);
  });

  it("options.stopLossHit + stopLossStopTrading: ei callbackia, halt heti kun len>250", async () => {
    const cb = jest.fn(async () => {});
    const candles = Array.from({ length: 260 }, (_, i) => mkCandle(i));
    const store = {};
    const opts = {
      ...baseOpts(),
      stopLossHit: true,
      stopLossStopTrading: true,
    } as ConfigOptions;
    const out = await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      opts,
      cb,
      progress,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(cb).toHaveBeenCalledTimes(0);
    expect(out.stopTradingHalted).toBe(true);
    expect(out.stopTradingAtCandleIndex).toBe(251);
  });

  it("shouldAbort: userAborted, ei stopTradingHalt", async () => {
    const cb = jest.fn(async () => {});
    const candles = Array.from({ length: 300 }, (_, i) => mkCandle(i));
    const store = {};
    let n = 0;
    const out = await simulateListenForCandlesticks(
      ["BTC/USDT"],
      candles,
      store,
      baseOpts(),
      cb,
      progress,
      () => {
        n += 1;
        return n === 252;
      },
      undefined,
      undefined,
      undefined
    );
    expect(out.userAborted).toBe(true);
    expect(out.abortedAtCandleIndex).toBe(251);
    expect(out.stopTradingHalted).toBeUndefined();
  });
});
