import { checkBeforePlacingOrder } from "./Orders";
import type { Filter } from "./Filters";

const filter = (over: Partial<Filter> = {}): Filter =>
  ({
    minPrice: 0,
    maxPrice: 100000,
    tickSize: 0.01,
    minQty: 0.001,
    maxQty: 1000,
    stepSize: 0.001,
    minNotional: 1,
    maxNotional: 0,
    ...over,
  }) as Filter;

describe("checkBeforePlacingOrder zero guards", () => {
  it("rejects price 0 even when minPrice filter is 0", () => {
    expect(checkBeforePlacingOrder(1, 0, filter())).toBe(false);
  });

  it("rejects non-positive quantity", () => {
    expect(checkBeforePlacingOrder(0, 100, filter())).toBe(false);
    expect(checkBeforePlacingOrder(-1, 100, filter())).toBe(false);
  });

  it("allows normal order", () => {
    expect(checkBeforePlacingOrder(0.01, 100, filter())).toBe(true);
  });
});
