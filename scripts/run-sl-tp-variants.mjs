/**
 * Ajaa SL/TP-variantit 0.25v ja tallentaa compare-*.json.
 * node scripts/run-sl-tp-variants.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runSimulationWithConfig } from "../build/hoobot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "simulation");

function loadBase() {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "settings/hoobot-options-simulate.json"), "utf8"));
  cfg.simulationHistoryYears = 0.25;
  cfg.simulate = true;
  const ex = cfg.exchanges?.[0];
  if (ex) {
    ex.console = "none";
    for (const s of ex.symbols || []) {
      s.simulationBuyAmountQuote = s.simulationBuyAmountQuote || 100;
      s.profit = { enabled: false, minimumSell: 1, minimumBuy: 0 };
      if (s.algorithmicAdaptive) {
        s.algorithmicAdaptive.agreementEaseMax = 12;
        s.algorithmicAdaptive.blockCounterTrendEntries = false;
        s.algorithmicAdaptive.conflictMinShare = 38;
        s.algorithmicAdaptive.enabled = true;
      }
      if (s.name === "BTC/EUR") s.agreement = 60;
      else s.agreement = 65;
      if (s.scoutConfirm) s.scoutConfirm.enabled = true;
    }
  }
  return cfg;
}

function applySlTp(cfg, slPnl, tpMin) {
  applyCustomSlTp(cfg, {
    slSell: slPnl,
    slBuy: Math.max(slPnl / 2, -4),
    tpSell: tpMin,
    tpBuy: Math.min(tpMin, 0.8),
  });
}

function applyCustomSlTp(cfg, { slSell, slBuy, tpSell, tpBuy }) {
  for (const s of cfg.exchanges[0].symbols) {
    if (s.stopLoss) s.stopLoss.pnl = slSell;
    if (s.stopLossBuy) s.stopLossBuy.pnl = slBuy;
    if (s.takeProfit) {
      s.takeProfit.minimum = tpSell;
      s.takeProfit.forceMinProfit = tpSell;
      s.takeProfit.limit = tpSell < 0.5 ? tpSell : 0.85;
      s.takeProfit.enabled = true;
    }
    if (s.takeProfitBuy) {
      s.takeProfitBuy.minimum = tpBuy;
      s.takeProfitBuy.forceMinProfit = tpBuy;
      s.takeProfitBuy.enabled = true;
    }
  }
}

function summarize(result) {
  if (!result.ok) return { ok: false, error: result.error };
  const syms = result.symbols || [];
  const sum = (k) => syms.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  return {
    ok: true,
    roiPercent: result.roiPercent,
    roi: result.roi,
    startingBalance: result.startingBalance,
    finalPortfolio: result.finalPortfolio,
    candleRows: result.candleRows,
    trades: sum("trades"),
    stopLosses: sum("stopLosses"),
    takeProfits: sum("takeProfits"),
    symbols: syms.map((s) => ({
      name: s.name,
      trades: s.trades,
      stopLosses: s.stopLosses,
      takeProfits: s.takeProfits,
      markPrice: s.markPrice,
    })),
  };
}

const VARIANTS = [
  { id: "sl7-tp02", file: "compare-sl7-tp02-result.json", sl: -7, tp: 0.2 },
  { id: "sl7-tp2", file: "compare-sl7-tp2-result.json", sl: -7, tp: 2 },
  { id: "sl10-tp05", file: "compare-sl10-tp05-result.json", sl: -10, tp: 0.5 },
  {
    id: "sl8-slBuy2-tp03-tpBuy02",
    file: "compare-sl8-custom-result.json",
    slSell: -8,
    slBuy: -2,
    tpSell: 0.3,
    tpBuy: 0.2,
  },
];

async function main() {
  const only = process.argv[2];
  const list = only ? VARIANTS.filter((v) => v.id === only) : VARIANTS;
  if (!list.length) {
    console.error("Unknown variant. Use:", VARIANTS.map((v) => v.id).join(", "));
    process.exit(1);
  }

  for (const v of list) {
    const cfg = loadBase();
    if (v.slSell != null) {
      applyCustomSlTp(cfg, v);
      console.log(
        `\n=== ${v.id}: SL sell ${v.slSell}% | SL buy ${v.slBuy}% | TP sell ${v.tpSell}% | TP buy ${v.tpBuy}% ===`
      );
    } else {
      applySlTp(cfg, v.sl, v.tp);
      console.log(`\n=== ${v.id}: SL ${v.sl}% TP min ${v.tp}% ===`);
    }
    const t0 = Date.now();
    const result = await runSimulationWithConfig(cfg, undefined, undefined, undefined, {
      saveCheckpoints: false,
    });
    const summary = summarize(result);
    const payload = {
      savedAt: new Date().toISOString(),
      variant: v,
      elapsedMin: Number(((Date.now() - t0) / 60000).toFixed(1)),
      result,
      summary,
    };
    const outPath = path.join(outDir, v.file);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(
      `${v.id} → ROI ${summary.roiPercent}% | trades ${summary.trades} | SL ${summary.stopLosses} | TP ${summary.takeProfits} | ${payload.elapsedMin} min`
    );
    console.log("Wrote", outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
