import { tradableBalance, type Balance } from "./Balances";

describe("tradableBalance", () => {
  it("prefers available over total crypto", () => {
    const b: Balance = { crypto: 1.5, available: 0.25, onOrder: 1.25, usdt: 100 };
    expect(tradableBalance(b)).toBe(0.25);
  });

  it("falls back to crypto when available missing", () => {
    expect(tradableBalance({ crypto: 2, usdt: 0 })).toBe(2);
  });

  it("returns 0 for undefined", () => {
    expect(tradableBalance(undefined)).toBe(0);
  });
});
