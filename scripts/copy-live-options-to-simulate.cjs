/**
 * Kopioi settings/hoobot-options.json → settings/hoobot-options-simulate.json
 *
 * Usage:
 *   node scripts/copy-live-options-to-simulate.cjs
 *   node scripts/copy-live-options-to-simulate.cjs --force
 *   node scripts/copy-live-options-to-simulate.cjs --dry-run
 *   node scripts/copy-live-options-to-simulate.cjs --force --symbol BTC/EUR
 *
 * Oletus: kopioi vain ensimmäinen enabled-symboli per pörssi (ei koko live-listaa).
 * --all-symbols kopioi kaikki live-symbolit (vanha käyttäytyminen).
 *
 * Aja projektijuuressa tai mistä vain: hakemisto etsitään cwd:stä ylöspäin (settings/hoobot-options*.json).
 */

const fs = require("fs");
const path = require("path");

const LIVE_BASENAME = "hoobot-options.json";
const SIM_BASENAME = "hoobot-options-simulate.json";

function findProjectRoot() {
  let dir = path.resolve(process.cwd());
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    if (seen.has(dir)) break;
    seen.add(dir);
    const settingsDir = path.join(dir, "settings");
    if (fs.existsSync(settingsDir)) {
      const marker = path.join(settingsDir, LIVE_BASENAME);
      const markerSim = path.join(settingsDir, SIM_BASENAME);
      if (fs.existsSync(marker) || fs.existsSync(markerSim)) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseFlags(argv) {
  let symbol = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--symbol" && argv[i + 1]) {
      symbol = String(argv[i + 1]).trim();
      break;
    }
  }
  return {
    force: argv.includes("--force") || argv.includes("-f"),
    dryRun: argv.includes("--dry-run") || argv.includes("-n"),
    allSymbols: argv.includes("--all-symbols"),
    symbol,
  };
}

function trimExchangesForSimulate(doc, opts) {
  const exchanges = doc.exchanges;
  if (!Array.isArray(exchanges)) return;
  const out = [];
  for (const rawEx of exchanges) {
    if (!rawEx || typeof rawEx !== "object") continue;
    const ex = { ...rawEx };
    const symbols = Array.isArray(ex.symbols) ? ex.symbols : [];
    let picked = [];
    if (opts.symbol) {
      const want = opts.symbol.toLowerCase();
      const hit = symbols.find((s) => s && String(s.name || "").toLowerCase() === want);
      if (hit) picked = [hit];
    } else if (opts.allSymbols) {
      picked = symbols;
    } else {
      const enabled = symbols.filter((s) => s && s.enabled !== false);
      if (enabled.length > 0) picked = [enabled[0]];
    }
    if (picked.length === 0) continue;
    ex.symbols = picked.map((s) => ({ ...s, enabled: true }));
    out.push(ex);
  }
  doc.exchanges = out;
}

function main() {
  const { force, dryRun, allSymbols, symbol } = parseFlags(process.argv.slice(2));
  const root = findProjectRoot();
  if (!root) {
    console.error(
      'Ei löytynyt projektijuurta (hakemisto jossa settings/ sisältää ' +
        LIVE_BASENAME +
        " tai " +
        SIM_BASENAME +
        "). Aja skripti Hoobot-projektin juuresta tai sen alihakemistosta."
    );
    process.exit(1);
  }

  const livePath = path.join(root, "settings", LIVE_BASENAME);
  const simPath = path.join(root, "settings", SIM_BASENAME);

  if (!fs.existsSync(livePath)) {
    console.error("Lähde puuttuu: " + livePath);
    process.exit(1);
  }

  if (fs.existsSync(simPath) && !force && !dryRun) {
    console.error(
      "Kohdetiedosto on jo olemassa: " +
        simPath +
        "\nKäynnistä --force tai -f vaihtaaksesi sen yli.\nTai --dry-run nähdäksesi mitä tehtäisiin."
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(livePath, "utf-8");
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error("Live-asetuksen JSON ei ole kelvollista:", e.message);
    process.exit(1);
  }

  if (doc != null && typeof doc === "object") {
    doc.running = false;
    doc.simulate = true;
    trimExchangesForSimulate(doc, { allSymbols, symbol });
  }

  const out = JSON.stringify(doc, null, 2) + "\n";

  console.log("Projektin juuri:", root);
  console.log("Lähde:", livePath);
  console.log("Kohde:", simPath);
  console.log(dryRun ? "(dry-run, ei kirjoteta)" : force && fs.existsSync(simPath) ? "(ylikirjoitetaan olemassa oleva kohde)" : "(luodaan/päivitetään)");

  if (dryRun) {
    console.log("OK — dry-run, " + Buffer.byteLength(out, "utf8") + " tavua JSON:ia.");
    process.exit(0);
  }

  fs.writeFileSync(simPath, out, "utf8");
  console.log("Valmis: kopio kirjoitettu:", simPath);
  process.exit(0);
}

main();
