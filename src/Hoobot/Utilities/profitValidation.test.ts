import { validateOptions, type ConfigOptions } from "./Args";

describe("validateOptions profit floors", () => {
  const base = (): ConfigOptions =>
    ({
      running: false,
      debug: false,
      startTime: "",
      license: "",
      simulate: false,
      discord: {},
      exchanges: [
        {
          name: "binance",
          mode: "algorithmic",
          symbols: [
            {
              name: "BTC/EUR",
              indicatorsPreset: "custom",
              timeframes: ["5m", "3m"],
              tradeFeePercentage: 0.1,
              profit: { enabled: true, minimumSell: 0.15, minimumBuy: -0.5 },
              stopLoss: { enabled: true, pnl: -1.2 },
              stopLossBuy: { enabled: true, pnl: -0.5 },
              indicators: {},
            },
          ],
        },
      ],
    }) as ConfigOptions;

  it("raises negative and sub-fee profit minimums to fee floor", () => {
    const out = validateOptions(base());
    const sym = out.exchanges[0]!.symbols![0]!;
    const floor = 0.1 * 2 + 0.05;
    expect(sym.profit!.minimumSell).toBeGreaterThanOrEqual(floor);
    expect(sym.profit!.minimumBuy).toBeGreaterThanOrEqual(floor);
  });

  it("keeps intentional stopLossBuy asymmetry (warn only, no auto-widen)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const out = validateOptions(base());
    const sym = out.exchanges[0]!.symbols![0]!;
    expect(sym.stopLossBuy!.pnl).toBe(-0.5);
    expect(sym.stopLoss!.pnl).toBe(-1.2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
