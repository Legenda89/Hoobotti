import { resolveSimYieldConfig, yieldToEventLoop } from "./simulateProcessGuard";

describe("simulateProcessGuard", () => {
  it("resolves yield defaults and env overrides", () => {
    const prevC = process.env.SIM_YIELD_EVERY_CANDLES;
    const prevM = process.env.SIM_YIELD_EVERY_MS;
    delete process.env.SIM_YIELD_EVERY_CANDLES;
    delete process.env.SIM_YIELD_EVERY_MS;
    expect(resolveSimYieldConfig().everyCandles).toBe(50);
    expect(resolveSimYieldConfig().everyMs).toBe(25);
    process.env.SIM_YIELD_EVERY_CANDLES = "80";
    process.env.SIM_YIELD_EVERY_MS = "15";
    expect(resolveSimYieldConfig()).toMatchObject({ everyCandles: 80, everyMs: 15 });
    if (prevC === undefined) delete process.env.SIM_YIELD_EVERY_CANDLES;
    else process.env.SIM_YIELD_EVERY_CANDLES = prevC;
    if (prevM === undefined) delete process.env.SIM_YIELD_EVERY_MS;
    else process.env.SIM_YIELD_EVERY_MS = prevM;
  });

  it("yields via timer and immediate", async () => {
    await expect(yieldToEventLoop(false)).resolves.toBeUndefined();
    await expect(yieldToEventLoop(true)).resolves.toBeUndefined();
  });
});
