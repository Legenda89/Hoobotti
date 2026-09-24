import { computeOpenPositionSnapshot, computeStaleExitStatus, durationToChartInterval, getTargetTimestamp, netUnrealizedPctAtMark } from "./dashboardHelpers";
import type { Trade } from "../Hoobot/Exchanges/Trades";

describe("dashboardHelpers", () => {
  it("maps duration to chart interval", () => {
    expect(durationToChartInterval("1D")).toBe("5m");
    expect(durationToChartInterval("1W")).toBe("1h");
  });

  it("computes open long unrealized snapshot", () => {
    const trades: Trade[] = [
      {
        symbol: "BTCEUR",
        id: "1",
        orderId: "1",
        orderListID: 0,
        price: "100",
        qty: "1",
        quoteQty: "100",
        commission: "0",
        commissionAsset: "EUR",
        time: 1000,
        isBuyer: true,
        isMaker: false,
        isBestMatch: true,
      },
    ];
    const snap = computeOpenPositionSnapshot(trades, 105, 0.1);
    expect(snap.open).toBe(true);
    expect(snap.side).toBe("LONG");
    expect(snap.unrealizedPct).toBeGreaterThan(4);
    expect(snap.unrealizedPct).toBeLessThan(5);
  });

  it("netUnrealizedPctAtMark subtracts round-trip fee from mark pnl", () => {
    const net = netUnrealizedPctAtMark(100, 105, "LONG", 0.1);
    expect(net).toBeCloseTo(4.8);
  });

  it("getTargetTimestamp returns past unix time", () => {
    const t = getTargetTimestamp("1D");
    expect(t).toBeLessThan(Math.floor(Date.now() / 1000));
  });

  it("computeStaleExitStatus reports remaining hours vs maxHours", () => {
    const now = 1_000_000_000_000;
    const entry = now - 10 * 3_600_000;
    const st = computeStaleExitStatus({ enabled: true, maxHours: 48 }, entry, true, now);
    expect(st.enabled).toBe(true);
    expect(st.maxHours).toBe(48);
    expect(st.ageHours).toBeCloseTo(10);
    expect(st.remainingHours).toBeCloseTo(38);
  });

  it("computeStaleExitStatus disables when maxHours is missing", () => {
    const st = computeStaleExitStatus({ enabled: true }, Date.now(), true);
    expect(st.enabled).toBe(false);
  });
});
