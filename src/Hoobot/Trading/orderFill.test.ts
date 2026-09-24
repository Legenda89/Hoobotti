import { isFullOrderFill, orderFillRatio, shouldClearTakeProfitAfterOrder } from "./orderFill";

describe("orderFillRatio", () => {
  it("returns ratio of executed to orig", () => {
    expect(orderFillRatio("0.99", "1")).toBeCloseTo(0.99);
  });
});

describe("isFullOrderFill", () => {
  it("treats FILLED as full", () => {
    expect(isFullOrderFill("FILLED")).toBe(true);
  });

  it("treats near-complete PARTIALLY_FILLED as full", () => {
    expect(isFullOrderFill("PARTIALLY_FILLED", "0.999", "1")).toBe(true);
  });

  it("does not treat small partial as full", () => {
    expect(isFullOrderFill("PARTIALLY_FILLED", "0.5", "1")).toBe(false);
  });
});

describe("shouldClearTakeProfitAfterOrder", () => {
  it("clears only on full fill", () => {
    expect(shouldClearTakeProfitAfterOrder("FILLED")).toBe(true);
    expect(shouldClearTakeProfitAfterOrder("CANCELED")).toBe(false);
    expect(shouldClearTakeProfitAfterOrder("PARTIALLY_FILLED", "0.1", "1")).toBe(false);
  });
});
