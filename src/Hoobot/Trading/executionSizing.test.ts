import { LIVE_BASE_RESERVE, computeLiveBuyExecution, computeLiveSellExecution, simSellBaseQuantity, simPriceFromCandle } from "./executionSizing";
import type { SymbolOptions } from "../Utilities/Args";
import type { Filter } from "../Exchanges/Filters";

const testFilter = {
  tickSize: 0.01,
  stepSize: 0.0001,
  minNotional: 1,
  maxNotional: 1e9,
} as Filter;

describe("executionSizing sim helpers", () => {
  it("uses candle close as sim price", () => {
    expect(simPriceFromCandle({ close: 42.5 })).toBe(42.5);
  });

  it("applies base reserve on sim sell quantity", () => {
    expect(simSellBaseQuantity(100)).toBe(100 * LIVE_BASE_RESERVE);
  });

  it("uses ask-side price for aggressive live buy", () => {
    const sym = { growingMax: { buy: 0 } } as SymbolOptions;
    const exec = computeLiveBuyExecution({
      quoteBalance: 100,
      orderBookBids: { "100": 1 },
      orderBookAsks: { "101": 2 },
      filter: testFilter,
      symbolOptions: sym,
      aggressiveEntry: true,
    });
    expect(exec?.aggressiveEntry).toBe(true);
    expect(exec?.roundedPrice).toBeGreaterThan(100);
  });

  it("does not shrink buy quote to tiny top-of-book base qty", () => {
    const sym = { growingMax: { buy: 0 } } as SymbolOptions;
    const exec = computeLiveBuyExecution({
      quoteBalance: 125,
      orderBookBids: { "67378.68": 0.00002 },
      orderBookAsks: { "67380": 0.00002 },
      filter: testFilter,
      symbolOptions: sym,
      aggressiveEntry: false,
    });
    expect(exec).not.toBeNull();
    // Koko tulee saldosta (~125), ei top-of-book 0.00002; floor+reserve voi jättää hieman alle 125.
    expect(exec!.roundedQuantityInQuote).toBeGreaterThan(100);
    expect(exec!.roundedQuantityInQuote).toBeLessThanOrEqual(125);
    expect(exec!.roundedQuantityInBase * exec!.roundedPrice).toBeGreaterThan(5);
  });

  it("does not shrink sell base to tiny top-of-book ask qty", () => {
    const sym = { growingMax: { sell: 0 } } as SymbolOptions;
    const exec = computeLiveSellExecution({
      baseBalance: 0.002,
      orderBookAsks: { "67378.68": 0.00002 },
      filter: testFilter,
      symbolOptions: sym,
    });
    expect(exec).not.toBeNull();
    // floorToStep(0.00196, 0.0001) → 0.0019; must not collapse to top-ask 0.00002
    expect(exec!.roundedQuantityInBase).toBeGreaterThanOrEqual(0.0019);
    expect(exec!.roundedQuantityInBase).not.toBe(0.00002);
    expect(exec!.roundedQuantityInBase * exec!.roundedPrice).toBeGreaterThan(5);
  });

  it("floors sell qty so it never exceeds free balance after step rounding", () => {
    const sym = { growingMax: { sell: 0 } } as SymbolOptions;
    const free = 0.000015;
    const exec = computeLiveSellExecution({
      baseBalance: free,
      orderBookAsks: { "100": 10 },
      filter: { ...testFilter, stepSize: 0.00001, tickSize: 0.01 } as Filter,
      symbolOptions: sym,
    });
    expect(exec).not.toBeNull();
    expect(exec!.roundedQuantityInBase).toBeLessThanOrEqual(free);
  });
});
