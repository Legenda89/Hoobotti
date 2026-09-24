/**
 * Päivittää settings/hoobot-options.json algorithmic-symbolit (live).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const livePath = path.join(root, "settings", "hoobot-options.json");

const RECOMMENDED = {
  sma: { enabled: false, length: 7, weight: 0 },
  renko: { enabled: false, weight: 0, multiplier: 1, brickSize: 0 },
  ema: { enabled: false, short: 9, long: 21, weight: 0 },
  macd: { enabled: true, fast: 12, slow: 26, signal: 9, weight: 1.2 },
  rsi: {
    enabled: true,
    length: 14,
    smoothing: { type: "EMA", length: 14 },
    history: 3,
    tresholds: { overbought: 70, oversold: 30 },
    weight: 1,
  },
  adx: { enabled: true, dilength: 14, adxSmoothing: 14, weight: 1 },
  atr: { enabled: true, length: 14, weight: 0 },
  obv: { enabled: false, length: 14, weight: 0 },
  cmf: {
    enabled: true,
    length: 20,
    history: 3,
    tresholds: { overbought: 0.1, oversold: -0.1 },
    weight: 0.9,
  },
  bb: {
    enabled: true,
    length: 20,
    multiplier: 2,
    average: "SMA",
    history: 3,
    weight: 1,
  },
  so: {
    enabled: false,
    kPeriod: 14,
    dPeriod: 3,
    smoothing: 3,
    tresholds: { overbought: 80, oversold: 20 },
    weight: 0,
  },
  srsi: {
    enabled: false,
    rsiLength: 14,
    stochLength: 14,
    kPeriod: 3,
    dPeriod: 3,
    smoothK: 3,
    smoothD: 3,
    history: 3,
    tresholds: { overbought: 80, oversold: 20 },
    weight: 0,
  },
  dmi: { enabled: false, dmiLength: 14, adxSmoothing: 14, weight: 0 },
  OpenAI: { enabled: false, key: "", model: "", history: "", overwrite: false },
};

const PRESET_KEYS = Object.keys(RECOMMENDED);

const defaultAdaptive = {
  enabled: true,
  maxCashCandles: 288,
  maxLongCandles: 192,
  conflictMinShare: 38,
};

function applyIndicators(sym) {
  const openAi = sym.indicators?.OpenAI;
  sym.indicators = structuredClone(RECOMMENDED);
  if (openAi && (openAi.key || openAi.enabled)) {
    sym.indicators.OpenAI = { ...RECOMMENDED.OpenAI, ...openAi };
  }
}

const raw = JSON.parse(fs.readFileSync(livePath, "utf8"));
let n = 0;
for (const ex of raw.exchanges ?? []) {
  if (ex.mode !== "algorithmic" || !Array.isArray(ex.symbols)) continue;
  for (const sym of ex.symbols) {
    if (!sym || typeof sym !== "object") continue;
    if (sym.indicatorsPreset === "custom") {
      console.log("Skip (custom):", sym.name);
      continue;
    }
    sym.indicatorsPreset = "complementary";
    applyIndicators(sym);
    sym.algorithmicAdaptive = { ...defaultAdaptive, ...(sym.algorithmicAdaptive ?? {}) };
    sym.algorithmicAdaptive.enabled = sym.algorithmicAdaptive.enabled !== false;
    console.log("OK:", sym.name, "enabled=", sym.enabled);
    n += 1;
  }
}
fs.writeFileSync(livePath, JSON.stringify(raw, null, 2) + "\n", "utf8");
console.log(`Updated ${n} symbol(s) in ${livePath}`);
