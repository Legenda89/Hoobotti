import type { SymbolOptions } from "../Utilities/Args";
import type { Trade } from "../Exchanges/Trades";
import { calculateProfitSignals, markStopLossHit } from "./Profit";

const sym = (profit: SymbolOptions["profit"], trendEnabled = true): SymbolOptions =>
  ({
    name: "BTC/EUR",
    timeframes: ["3m"],
    minimumTimeSinceLastTrade: 0,
    trend: trendEnabled ? { enabled: true, current: "LONG", timeframe: "4h", ema: { short: 9, long: 21 } } : undefined,
    takeProfit: { enabled: false, minimum: 0, drop: 0, limit: 0, current: 0 },
    stopLoss: { enabled: false, stopTrading: false, pnl: -2, agingPerHour: 0 },
    profit,
  }) as SymbolOptions;

const lastBuy = (): Trade =>
  ({
    isBuyer: true,
    price: "100",
    qty: "1",
    time: 1_000_000,
  }) as Trade;

describe("profit.minimum thresholds", () => {
  it("ignores minimumSell/Buy when profit.enabled is false", async () => {
    const signals = await calculateProfitSignals(
      "LONG",
      "SELL",
      lastBuy(),
      0,
      0.5,
      1_010_000,
      sym({ enabled: false, minimumSell: 3, minimumBuy: 2 })
    );
    expect(signals.check).toBe("SELL");
  });

  it("holds below minimumSell when profit.enabled is true", async () => {
    const signals = await calculateProfitSignals(
      "LONG",
      "SELL",
      lastBuy(),
      0,
      0.5,
      1_010_000,
      sym({ enabled: true, minimumSell: 3, minimumBuy: 2 })
    );
    expect(signals.check).toBe("HOLD");
  });

  it("allows sell when unrealized meets minimumSell and enabled", async () => {
    const signals = await calculateProfitSignals(
      "LONG",
      "SELL",
      lastBuy(),
      0,
      3.5,
      1_010_000,
      sym({ enabled: true, minimumSell: 3, minimumBuy: 2 })
    );
    expect(signals.check).toBe("SELL");
  });

  it("markStopLossHit sets stopLoss.hit", () => {
    const s = sym({ enabled: false, minimumSell: 0, minimumBuy: 0 });
    markStopLossHit(s, "SELL");
    expect(s.stopLoss?.hit).toBe(true);
  });

  it("time-stop flattens a stale red long after maxHours", async () => {
    const s = sym({ enabled: true, minimumSell: 3, minimumBuy: 2 });
    s.forcedExit = { enabled: true, candles: 18, change: 0.15, minProfit: 0.2, maxHours: 12 };
    s.stopLoss = { enabled: true, stopTrading: false, pnl: -8, agingPerHour: 0, hit: false };
    const twelveHoursLater = 1_000_000 + 12 * 60 * 60 * 1000;
    const signals = await calculateProfitSignals("LONG", "SELL", lastBuy(), 0, -1.2, twelveHoursLater, s);
    expect(signals.check).toBe("STALE_EXIT");
  });

  it("does not time-stop before maxHours when red", async () => {
    const s = sym({ enabled: true, minimumSell: 3, minimumBuy: 2 });
    s.forcedExit = { enabled: true, candles: 18, change: 0.15, minProfit: 0.2, maxHours: 12 };
    const elevenHoursLater = 1_000_000 + 11 * 60 * 60 * 1000;
    const signals = await calculateProfitSignals("LONG", "SELL", lastBuy(), 0, -1.2, elevenHoursLater, s);
    expect(signals.check).toBe("HOLD");
  });
});
