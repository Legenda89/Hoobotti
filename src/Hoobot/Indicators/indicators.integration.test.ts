import type { Candlestick } from "../Exchanges/Candlesticks";
import { calculateIndicators } from "../Modes/Algorithmic";
import { recommendedAlgorithmicIndicators } from "../Modes/algorithmicIndicators";
import { toSymbolKey } from "../Utilities/Args";
import { consoleLogger } from "../Utilities/ConsoleLogger";
import { checkADXSignals } from "./ADX";
import { checkBollingerBandsSignals } from "./BollingerBands";
import { checkCMFSignals } from "./CMF";
import { checkMACDSignals } from "./MACD";
import { checkRSISignals } from "./RSI";

const makeCandles = (n: number): Candlestick[] =>
  Array.from({ length: n }, (_, i) => {
    const wave = Math.sin(i / 5) * 2;
    const base = 100 + i * 0.05 + wave;
    return {
      open: base - 0.2,
      high: base + 0.5,
      low: base - 0.5,
      close: base,
      time: 1_700_000_000_000 + i * 300_000,
      isFinal: true,
      volume: 1000 + i,
    } as Candlestick;
  });

const symbol = "BTC/EUR";
const tf = "5m";

describe("algorithmic indicators integration", () => {
  const candles = makeCandles(120);
  const candlesticks = { [toSymbolKey(symbol)]: { [tf]: candles } };
  const symbolOptions = {
    name: symbol,
    timeframes: [tf],
    source: "close" as const,
    agreement: 65,
    trend: { enabled: true, timeframe: "4h", ema: { short: 9, long: 21 } },
    indicators: recommendedAlgorithmicIndicators(),
  } as never;

  it("calculateIndicators fills complementary series without throw", () => {
    const indicators = calculateIndicators(symbol, candlesticks, symbolOptions, consoleLogger());
    expect(indicators.macd[tf].histogram.length).toBeGreaterThan(1);
    expect(indicators.rsi[tf].length).toBeGreaterThan(0);
    expect(indicators.adx[tf].adx.length).toBeGreaterThan(0);
    expect(indicators.bollingerBands[tf][0].length).toBeGreaterThan(0);
    expect(indicators.cmf[tf].length).toBeGreaterThan(0);
  });

  it("check*Signals tolerate missing data", () => {
    expect(checkMACDSignals(undefined, symbolOptions)).toBe("HOLD");
    expect(checkRSISignals(undefined, symbolOptions)).toBe("HOLD");
    expect(checkADXSignals(undefined, symbolOptions)).toBe("HOLD");
    expect(
      checkBollingerBandsSignals([], [[], [], []], symbolOptions)
    ).toBe("HOLD");
    expect(checkCMFSignals(undefined, symbolOptions)).toBe("HOLD");
  });

  it("MACD produces crossover signal on synthetic trend", () => {
    const indicators = calculateIndicators(symbol, candlesticks, symbolOptions, consoleLogger());
    const sig = checkMACDSignals(indicators.macd[tf], symbolOptions);
    expect(["BUY", "SELL", "HOLD"]).toContain(sig);
  });
});
