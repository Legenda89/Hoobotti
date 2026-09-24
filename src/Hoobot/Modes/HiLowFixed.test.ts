import {
  evaluateHilowFixedSignal,
  quoteEdgeForRebuy,
  quotePnlLong,
  resolveHilowFixedConfig,
} from "./HiLowFixed";

describe("HiLowFixed", () => {
  const cfg = resolveHilowFixedConfig({
    name: "BTC/EUR",
    hilowFixed: { sellProfitQuote: 5, buyMoveQuote: 7 },
  } as never);

  const ob = (bid: number, ask: number) => ({
    bids: { [bid.toFixed(2)]: 1 },
    asks: { [ask.toFixed(2)]: 1 },
  });

  it("sells long when quote profit reaches threshold", () => {
    const pnl = quotePnlLong(100, 1, 106, 0);
    expect(pnl).toBeGreaterThanOrEqual(5);
    expect(evaluateHilowFixedSignal(true, 100, 1, ob(106, 106), 0, cfg)).toBe("TAKE_PROFIT");
  });

  it("buys after sell when quote edge reaches threshold", () => {
    const edge = quoteEdgeForRebuy(105, 1, 97, 0);
    expect(edge).toBeGreaterThanOrEqual(7);
    expect(evaluateHilowFixedSignal(false, 105, 1, ob(97, 97), 0, cfg)).toBe("TAKE_PROFIT");
  });

  it("does not buy on small dip from sell price", () => {
    expect(evaluateHilowFixedSignal(false, 105, 1, ob(102, 102), 0, cfg)).toBe("HOLD");
  });

  it("ignores stop loss when stopLossQuote is omitted", () => {
    const noSl = resolveHilowFixedConfig({
      name: "BTC/EUR",
      hilowFixed: { sellProfitQuote: 5, buyMoveQuote: 7 },
    } as never);
    expect(noSl.stopLossQuote).toBeUndefined();
    const bigLoss = quotePnlLong(100, 1, 90, 0);
    expect(bigLoss).toBeLessThan(-5);
    expect(evaluateHilowFixedSignal(true, 100, 1, ob(90, 90), 0, noSl)).toBe("HOLD");
  });
});
