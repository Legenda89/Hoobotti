/**
 * Simulaation terveystarkistus: asetukset, viimeisin grid-progress, tradeGates-logiikka.
 * Aja: node scripts/check-simulation-health.cjs
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const issues = [];
  const ok = [];

  const simOptsPath = path.join(root, "settings", "hoobot-options-simulate.json");
  const simOpts = readJson(simOptsPath);
  if (!simOpts) {
    issues.push(`Puuttuu ${simOptsPath}`);
  } else {
    const sym = simOpts.exchanges?.[0]?.symbols?.[0];
    if (!sym?.enabled) issues.push("BTC/EUR ei ole enabled simulate-asetuksissa.");
    else {
      ok.push(`Symboli: ${sym.name}, agreement ${sym.agreement}%`);
      ok.push(
        `TP: enabled=${sym.takeProfit?.enabled}, min=${sym.takeProfit?.minimum}, drop=${sym.takeProfit?.drop}, limit=${sym.takeProfit?.limit}`
      );
      ok.push(`SL: enabled=${sym.stopLoss?.enabled}, pnl=${sym.stopLoss?.pnl}`);
      ok.push(`forcedExit: enabled=${sym.forcedExit?.enabled}`);
      ok.push(`profit: minSell=${sym.profit?.minimumSell}, minBuy=${sym.profit?.minimumBuy}`);
      if (sym.stopLoss?.enabled !== true && sym.forcedExit?.enabled !== true) {
        issues.push(
          "Baseline: stopLoss ja forcedExit pois päältä — sulut tulevat indikaattoreista/TP:stä; odota paljon SELL/BUY-tageja, ei välttämättä TAKE_PROFIT."
        );
      }
      if ((sym.takeProfit?.minimum ?? 0) >= 0.4) {
        issues.push(`TP minimum ${sym.takeProfit?.minimum}% on korkea (H14-voittaja ~0.1) — trailing aktivoituu myöhään.`);
      }
    }
  }

  const candleDir = path.join(root, "candlestore");
  const csv5m = fs.existsSync(candleDir)
    ? fs.readdirSync(candleDir).filter((f) => /^BTCEUR-5m-/.test(f))
    : [];
  if (csv5m.length === 0) issues.push("candlestore: ei BTCEUR-5m CSV-tiedostoja.");
  else ok.push(`candlestore: ${csv5m.length} BTCEUR-5m -tiedostoa.`);

  const progressPath = path.join(root, "simulation", "grid-progress-summary.json");
  const progress = readJson(progressPath);
  if (!progress?.results?.length) {
    issues.push("grid-progress-summary.json puuttuu tai tyhjä — ei viimeisimpiä varianttituloksia.");
  } else {
    const rows = progress.results.filter((r) => r.result?.ok);
    ok.push(`grid-progress: ${rows.length} onnistunutta varianttia (yhteensä ${progress.results.length}).`);
    for (const row of rows.slice(0, 8)) {
      const s = row.result.symbols?.[0];
      const trades = s?.trades ?? 0;
      const tp = s?.takeProfits ?? 0;
      const sl = s?.stopLosses ?? 0;
      const line = `  #${row.variantIndex + 1}: trades=${trades}, TAKE_PROFIT=${tp}, STOP_LOSS=${sl}, ROI=${row.result.roiPercent}%`;
      if (trades === 0) issues.push(`${line} ← EI KAUPPOJA`);
      else if (tp === 0 && trades > 50) issues.push(`${line} ← kauppoja mutta 0 TAKE_PROFIT-tagia`);
      else ok.push(line);
    }
    const allZeroTp = rows.every((r) => (r.result.symbols?.[0]?.takeProfits ?? 0) === 0);
    if (rows.length > 0 && allZeroTp) {
      issues.push(
        "Kaikissa tarkistetuissa varianteissa takeProfits=0 — trailing-TP ei merkitse kauppoja TAKE_PROFIT (tarkista minimum/drop/limit ja currentMaxSource)."
      );
    }
  }

  const buildHoobot = path.join(root, "build", "hoobot.js");
  if (!fs.existsSync(buildHoobot)) {
    issues.push("build/hoobot.js puuttuu — aja npm run build:production ennen simulate-palvelinta.");
  } else ok.push("build/hoobot.js löytyy.");

  console.log("\n=== Simulaation terveystarkistus ===\n");
  if (ok.length) {
    console.log("OK / havainnot:");
    ok.forEach((l) => console.log("  •", l));
  }
  if (issues.length) {
    console.log("\nHuomiot / mahdolliset ongelmat:");
    issues.forEach((l) => console.log("  ⚠", l));
  } else {
    console.log("\nEi automaattisia huomioita.");
  }
  console.log("\nAvauskauppa (koodi): profit SKIP + tyhjä tradeHistory sallitaan (tradeGates.ts).");
  console.log("Konsoli: [sim] BUY/SELL ja Replay | sim-kauppoja N (uusi build).\n");
}

main();
