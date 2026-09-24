/**
 * Vertaa entry-portti -variantteja (0.25v, kaikki sim-symbolit).
 * node scripts/compare-entry-gates.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runSimulationWithConfig } from "../build/hoobot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadBase() {
  const live = JSON.parse(fs.readFileSync(path.join(root, "settings/hoobot-options.json"), "utf8"));
  const sim = JSON.parse(fs.readFileSync(path.join(root, "settings/hoobot-options-simulate.json"), "utf8"));
  const cfg = JSON.parse(JSON.stringify(live));
  cfg.simulationHistoryYears = 0.1;
  cfg.simulate = true;
  const ex = cfg.exchanges?.[0];
  if (ex) {
    ex.console = "none";
    for (const s of ex.symbols || []) {
      s.simulationBuyAmountQuote = s.simulationBuyAmountQuote || 100;
      if (s.scoutConfirm) s.scoutConfirm.enabled = true;
    }
  }
  // käytä sim-tiedoston symbolilistaa jos lyhyempi
  if (sim.exchanges?.[0]?.symbols?.length) {
    cfg.exchanges[0].symbols = JSON.parse(JSON.stringify(sim.exchanges[0].symbols));
    for (const s of cfg.exchanges[0].symbols) {
      s.simulationBuyAmountQuote = s.simulationBuyAmountQuote || 100;
    }
  }
  return cfg;
}

function patchAllSymbols(cfg, fn) {
  for (const s of cfg.exchanges[0].symbols || []) {
    if (s.enabled === false) continue;
    fn(s);
  }
}

const VARIANTS = [
  {
    id: "baseline",
    label: "Nykyinen (easeMax 8, agreement 63/68)",
    apply(cfg) {},
  },
  {
    id: "ease12",
    label: "Vain agreementEaseMax 12",
    apply(cfg) {
      patchAllSymbols(cfg, (s) => {
        s.algorithmicAdaptive = { ...s.algorithmicAdaptive, agreementEaseMax: 12 };
      });
    },
  },
  {
    id: "moderate",
    label: "easeMax 12 + agreement -3 + conflict 38",
    apply(cfg) {
      const agree = { "BTC/EUR": 60, "XRP/BRL": 65, "ETH/USDC": 65 };
      patchAllSymbols(cfg, (s) => {
        if (agree[s.name] != null) s.agreement = agree[s.name];
        s.algorithmicAdaptive = {
          ...s.algorithmicAdaptive,
          agreementEaseMax: 12,
          conflictMinShare: 38,
        };
      });
    },
  },
  {
    id: "meanrev",
    label: "moderate + counter-trend OFF (mean reversion)",
    apply(cfg) {
      const agree = { "BTC/EUR": 60, "XRP/BRL": 65, "ETH/USDC": 65 };
      patchAllSymbols(cfg, (s) => {
        if (agree[s.name] != null) s.agreement = agree[s.name];
        s.algorithmicAdaptive = {
          ...s.algorithmicAdaptive,
          agreementEaseMax: 12,
          conflictMinShare: 38,
          blockCounterTrendEntries: false,
        };
      });
    },
  },
  {
    id: "ease15-loose",
    label: "easeMax 15 + agreement -4 + counter-trend OFF",
    apply(cfg) {
      const agree = { "BTC/EUR": 59, "XRP/BRL": 64, "ETH/USDC": 64 };
      patchAllSymbols(cfg, (s) => {
        if (agree[s.name] != null) s.agreement = agree[s.name];
        s.algorithmicAdaptive = {
          ...s.algorithmicAdaptive,
          agreementEaseMax: 15,
          conflictMinShare: 38,
          blockCounterTrendEntries: false,
        };
      });
    },
  },
];

function summarize(result) {
  if (!result.ok) return { ok: false, error: result.error };
  const syms = result.symbols || [];
  const trades = syms.reduce((n, s) => n + (s.trades || 0), 0);
  const sl = syms.reduce((n, s) => n + (s.stopLosses || 0), 0);
  const tp = syms.reduce((n, s) => n + (s.takeProfits || 0), 0);
  return {
    ok: true,
    roiPercent: result.roiPercent,
    roi: result.roi,
    startingBalance: result.startingBalance,
    finalPortfolio: result.finalPortfolio,
    trades,
    sl,
    tp,
    perSymbol: syms.map((s) => ({
      name: s.name,
      trades: s.trades,
      sl: s.stopLosses,
      tp: s.takeProfits,
    })),
  };
}

async function main() {
  const outPath = path.join(root, "simulation", "gate-compare-results.json");
  const results = [];
  console.log(`\n=== Entry-gate vertailu (${VARIANTS.length} varianttia, 0.1v) ===\n`);

  for (let i = 0; i < VARIANTS.length; i++) {
    const v = VARIANTS[i];
    const cfg = loadBase();
    v.apply(cfg);
    console.log(`[${i + 1}/${VARIANTS.length}] ${v.id}: ${v.label}`);
    const t0 = Date.now();
    const result = await runSimulationWithConfig(cfg, undefined, undefined, undefined, {
      saveCheckpoints: false,
    });
    const summary = summarize(result);
    const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);
    const row = { ...v, elapsedMin, summary };
    results.push(row);
    console.log(
      `  → ROI ${summary.roiPercent ?? "ERR"}% | kaupat ${summary.trades ?? 0} | SL ${summary.sl ?? 0} | TP ${summary.tp ?? 0} | ${elapsedMin} min\n`
    );
    fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), results }, null, 2));
  }

  const ranked = results
    .filter((r) => r.summary.ok && r.summary.trades > 0)
    .sort((a, b) => (b.summary.roi ?? -999) - (a.summary.roi ?? -999));

  console.log("\n=== Ranking (vähintään 1 kauppa) ===");
  if (!ranked.length) {
    console.log("Ei variantteja joissa kauppoja — kaikki liian tiukat.");
  } else {
    for (const r of ranked) {
      console.log(
        `  ${r.id}: ROI ${r.summary.roiPercent}% | ${r.summary.trades} kauppaa | ${r.label}`
      );
    }
    console.log(`\nParas: ${ranked[0].id} (${ranked[0].label})`);
  }
  console.log(`\nTallennettu: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
