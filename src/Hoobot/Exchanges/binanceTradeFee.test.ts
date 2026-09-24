import type { SymbolOptions } from "../Utilities/Args";
import {
  fetchBinanceTakerFeePct,
  inferBinanceTradeFeePctFromBnbBalance,
  parseBinanceTakerCommissionPct,
  shouldAutoResolveTradeFeePercentage,
} from "./binanceTradeFee";
import type { Balances } from "./Balances";

const sym = (partial: Partial<SymbolOptions>): SymbolOptions => partial as SymbolOptions;

describe("binanceTradeFee", () => {
  it("parses Binance taker commission string to percent points", () => {
    expect(parseBinanceTakerCommissionPct([{ takerCommission: "0.001000" }])).toBeCloseTo(0.1);
    expect(parseBinanceTakerCommissionPct([{ takerCommission: "0.000750" }])).toBeCloseTo(0.075);
  });

  it("infers BNB discount from balance", () => {
    const withBnb: Balances = { BNB: { crypto: 0.5, usdt: 100 } };
    const withoutBnb: Balances = { USDT: { crypto: 100, usdt: 100 } };
    expect(inferBinanceTradeFeePctFromBnbBalance(withBnb)).toBe(0.075);
    expect(inferBinanceTradeFeePctFromBnbBalance(withoutBnb)).toBe(0.1);
  });

  it("auto-resolves on live binance unless explicitly disabled", () => {
    expect(shouldAutoResolveTradeFeePercentage(sym({ tradeFeePercentageAuto: false }), "binance")).toBe(
      false
    );
    expect(shouldAutoResolveTradeFeePercentage(sym({}), "binance")).toBe(true);
    expect(shouldAutoResolveTradeFeePercentage(sym({}), "nonkyc")).toBe(false);
  });

  it("calls tradeFee with callback first, symbol second (node-binance-api signature)", async () => {
    const tradeFee = jest.fn((_cb: unknown, symbol?: string) =>
      Promise.resolve([{ takerCommission: "0.000750", symbol }])
    );
    const exchange = { candlesticks: jest.fn(), tradeFee } as never;
    const pct = await fetchBinanceTakerFeePct(exchange, "BTC/EUR");
    expect(pct).toBeCloseTo(0.075);
    expect(tradeFee).toHaveBeenCalledWith(undefined, "BTCEUR");
  });
});
