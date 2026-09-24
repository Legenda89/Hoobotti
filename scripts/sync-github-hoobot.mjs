#!/usr/bin/env node
/**
 * Synkronoi julkaisukelpoinen kopio Hoobot15 → hoobot/
 *
 * Käyttö:
 *   node scripts/sync-github-hoobot.mjs           # päivitä hoobot/ (säilyttää .git jos olemassa)
 *   node scripts/sync-github-hoobot.mjs --handoff # täysi paketti alkuperäiselle tekijälle (poistaa .git)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = path.join(repoRoot, "hoobot");
const handoffMode = process.argv.includes("--handoff") || process.env.HOOBOT_HANDOFF === "1";

const COPY_DIRS = ["src", "scripts"];
const COPY_FILES = [
  "package.json",
  "package-lock.json",
  "webpack.config.js",
  "tsconfig.json",
  "jest.config.cjs",
];

const SETTINGS_FILES = [
  "hoobot-options.json.example",
  "sim-grid.example.json",
  "sim-grid-range.example.json",
  "takeprofit-grid-axes.example.json",
  "axis-grid-extreme.json",
  "axis-grid-algorithmic.json",
  "axis-grid-algorithmic-compact.json",
  "axis-grid-algorithmic-refine.json",
];

const SKIP_DIR_NAMES = new Set(["node_modules", "build", "build-dev", "build-ts", ".git"]);
const SKIP_SCRIPT_NAMES = new Set(["sync-github-hoobot.mjs"]);

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.isDirectory() && SKIP_DIR_NAMES.has(ent.name)) continue;
    if (!ent.isDirectory() && SKIP_SCRIPT_NAMES.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.version ?? "0.0.0";
}

function writeHoobotOptionsTemplate() {
  const examplePath = path.join(repoRoot, "settings", "hoobot-options.json.example");
  const outPath = path.join(destRoot, "settings", "hoobot-options.json");
  const raw = fs.readFileSync(examplePath, "utf8");
  const cfg = JSON.parse(raw);
  cfg.license = "";
  if (cfg.discord) {
    cfg.discord.token = "";
    cfg.discord.applicationId = "";
    cfg.discord.serverId = "";
    cfg.discord.channelId = "";
  }
  if (cfg.discordSecondary) {
    cfg.discordSecondary.enabled = false;
    cfg.discordSecondary.token = "";
    cfg.discordSecondary.applicationId = "";
    cfg.discordSecondary.serverId = "";
    cfg.discordSecondary.channelId = "";
  }
  if (Array.isArray(cfg.exchanges)) {
    for (const ex of cfg.exchanges) {
      if (ex && typeof ex === "object") {
        ex.key = "";
        ex.secret = "";
      }
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

function writeGitignore() {
  const text = `# Dependencies
/node_modules

# Build
/build
/build-dev
/build-ts

# Runtime
/logs/*
!/logs/.gitkeep
/blocks/*
!/blocks/.gitkeep
/candlestore/
/simulation/

# Secrets & local config
/settings/hoobot-options.json
/settings/hoobot-options-simulate.json
/settings/binance.json
/settings/xeggex.json
/settings/force.json
.env
.env.*

# OS / IDE
.DS_Store
Thumbs.db
.idea/
.vscode/
`;
  fs.writeFileSync(path.join(destRoot, ".gitignore"), text, "utf8");
}

function writeHandoff(version) {
  const text = `# Hoobot ${version} — lähdekoodipaketti (handoff)

Tämä kansio on **valmis lähdekoodipaketti** ilman API-avaimia, Discord-tokeneita tai henkilökohtaisia asetuksia.
Voit kopioida sen alkuperäiseen Hoobot-repositorioon ja tehdä branchin + mergen itse.

## Mitä paketissa on

| Polku | Sisältö |
|-------|---------|
| \`src/\` | Koko sovellus (Frontend, moodit, indikaattorit, simulaatio, Discord) |
| \`scripts/\` | Apuskriptit (Binance timeout, sim-kopiot, preset) |
| \`settings/*.example\` | Esimerkkikonfiguraatiot ja axis-grid-extreme |
| \`package.json\` | Versio **${version}**, riippuvuudet, npm-skriptit |
| \`webpack.config.js\`, \`tsconfig.json\`, \`jest.config.cjs\` | Build ja testit |
| \`CHANGELOG-${version}.md\` | Muutoslista |
| \`PACKAGE-CONTENTS.txt\` | Tiedostoluettelo (generoitu synkissä) |

**Ei mukana:** \`node_modules\`, \`build/\`, logit, simulaatiotulokset, omat \`hoobot-options.json\`-avaimet.

## Pika-asennus (testaa paketti erikseen)

\`\`\`bash
cd hoobot
npm install
cp settings/hoobot-options.json.example settings/hoobot-options.json
# täytä API-avaimet settings/hoobot-options.json
npm run build
npm run start:nopm2
\`\`\`

Web UI: http://localhost:5656

## Merge alkuperäiseen repoon (suositus)

\`\`\`bash
# 1) Alkuperäinen repo
cd /path/to/original-hoobot
git checkout -b feature/contrib-${version.replace(/\./g, "-")}

# 2) Kopioi tämän paketin sisältö repojuureen (älä kopioi .git tätä kansiota varten)
# Windows PowerShell esimerkki:
#   Copy-Item -Path "E:\\path\\to\\hoobot\\*" -Destination "." -Recurse -Force

# 3) Tarkista diff, ratkaise konfliktit
git status
git diff

# 4) Commit + merge
git add -A
git commit -m "Merge community ${version}: extreme, adaptive algorithmic, indicator fixes"
# git merge feature/contrib-... main  (tai PR GitHubissa)
\`\`\`

## Tärkeimmät uudet / muuttuneet alueet

- **Extreme-moodi** — \`src/Hoobot/Modes/Extreme.ts\`, UI, sim-grid
- **Adaptiivinen algorithmic** — \`algorithmicAdaptive.ts\`, UI-lohko
- **Complementary-indikaattoripreset** — \`algorithmicIndicators.ts\`
- **Indikaattorikorjaukset** — EMA, ADX, CMF, MACD, Bollinger, \`indicatorVoteWeights.ts\`
- **Sim / TP / order** — useita korjauksia (katso CHANGELOG)

## Huomio

- \`hilow_fixed\` (EUR) on poistettu moodilistasta; \`HiLowFixed.ts\` säilyy quote-apufunktioina Extreme-moodille.
- \`settings/hoobot-options.json\` tässä paketissa on vain tyhjä pohja — älä commitoi oikeita avaimia.

## Yhteystiedot

Paketti tuotettu yksityisestä Hoobot15-kehitysympäristöstä. Kysymykset merge-konflikteista: vertaa \`CHANGELOG-${version}.md\` ja \`git diff\` uusiin tiedostoihin.
`;
  fs.writeFileSync(path.join(destRoot, "HANDOFF.md"), text, "utf8");
}

function writeChangelog(version) {
  const text = `# Changelog ${version}

## Uudet ominaisuudet

- **Extreme-moodi** — quote-ping-pong EUR-rajoilla, volatiliteetti/trendi, idle-pakko (\`Extreme.ts\`, \`axis-grid-extreme.json\`)
- **Adaptiivinen algorithmic** — ATR-skaalaus TP/profit-min:eihin, trendi-agreement, äänestyskonflikti → HOLD, idle-ease (\`algorithmicAdaptive.ts\`)
- **Complementary-indikaattoripreset** — MACD, RSI, ADX, BB, CMF oletuksena (\`algorithmicIndicators.ts\`)
- **Indikaattoripainojen snapshot** — boostit eivät jää seuraaville timeframeille (\`indicatorVoteWeights.ts\`)

## Korjaukset

- **EMA** — risteymäsignaali ei enää ylikirjoitu HOLD:lla
- **ADX** — ei BOTH-ääntä molempiin suuntiin; suunta +DI/−DI
- **CMF** — SMA toimii lyhyellä historialla
- **MACD / Bollinger** — guardit puuttuvaa dataa vastaan; BB lower band -indeksi
- **Trend EMA** — käyttää \`trend.ema\`, ei pakota trade-EMA:ta
- **Profit / TP** — trailing, forceAfter, sim-live -pariteetti (useita committeja)
- **Sim** — PnL, fees, profit-gating, grid cache

## Poistot / muutokset

- **hilow_fixed** poistettu live/sim/UI-moodeista (apufunktiot säilyvät \`HiLowFixed.ts\`)

## Testit

- \`*.test.ts\` — adaptive, indicators, EMA, ADX, CMF, Bollinger, MACD, Extreme, tradeGates, sim

## Versio

- \`package.json\`: **${version}**
`;
  fs.writeFileSync(path.join(destRoot, `CHANGELOG-${version}.md`), text, "utf8");
}

function writeReadme(version) {
  const text = `# Hoobot ${version}

Algorithmic crypto trading bot (Binance, NonKYC, MEXC) with web UI, simulation, and grid search.

**Aloita tästä:** [HANDOFF.md](./HANDOFF.md) — miten asennat ja mergeät tämän paketin.

## Quick start

\`\`\`bash
npm install
cp settings/hoobot-options.json.example settings/hoobot-options.json
npm run build
npm run start:nopm2
\`\`\`

## Docs in this package

- [HANDOFF.md](./HANDOFF.md) — merge-ohje alkuperäiseen repoon
- [CHANGELOG-${version}.md](./CHANGELOG-${version}.md) — muutokset
- [PACKAGE-CONTENTS.txt](./PACKAGE-CONTENTS.txt) — tiedostolista

## Scripts

\`\`\`bash
npm test
npm run simulate
npm run sim:grid
\`\`\`
`;
  fs.writeFileSync(path.join(destRoot, "README.md"), text, "utf8");
}

function writePackageManifest(version) {
  const lines = [
    `Hoobot source package ${version}`,
    `Generated: ${new Date().toISOString()}`,
    `From: Hoobot15 private workspace`,
    `Mode: ${handoffMode ? "handoff (no .git)" : "github-sync"}`,
    "",
    "See HANDOFF.md and CHANGELOG-" + version + ".md",
  ];
  fs.writeFileSync(path.join(destRoot, "PACKAGE-MANIFEST.txt"), `${lines.join("\n")}\n`, "utf8");
}

function listFiles(dir, base = "") {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git") continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out.sort();
}

function writePackageContents() {
  const files = listFiles(destRoot);
  const text = [
    "# Package file list (generated)",
    `# Total files: ${files.length}`,
    "",
    ...files,
  ].join("\n");
  fs.writeFileSync(path.join(destRoot, "PACKAGE-CONTENTS.txt"), `${text}\n`, "utf8");
}

function clearDest() {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const ent of fs.readdirSync(destRoot, { withFileTypes: true })) {
    if (!handoffMode && ent.name === ".git") continue;
    rmrf(path.join(destRoot, ent.name));
  }
}

const version = readVersion();
console.log(`Syncing → ${destRoot} (v${version}, handoff=${handoffMode})`);
clearDest();

for (const dir of COPY_DIRS) {
  copyDir(path.join(repoRoot, dir), path.join(destRoot, dir));
}

for (const file of COPY_FILES) {
  const src = path.join(repoRoot, file);
  if (fs.existsSync(src)) copyFile(src, path.join(destRoot, file));
}

const settingsDest = path.join(destRoot, "settings");
fs.mkdirSync(settingsDest, { recursive: true });
for (const name of SETTINGS_FILES) {
  const src = path.join(repoRoot, "settings", name);
  if (fs.existsSync(src)) copyFile(src, path.join(settingsDest, name));
}

writeHoobotOptionsTemplate();
writeGitignore();
writeHandoff(version);
writeChangelog(version);
writeReadme(version);
writePackageManifest(version);

for (const sub of ["logs", "blocks", "candlestore", "simulation"]) {
  const d = path.join(destRoot, sub);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, ".gitkeep"), "", "utf8");
}

writePackageContents();

if (handoffMode) {
  console.log("Handoff package ready. Zip and send hoobot/ folder (no .git included).");
} else {
  console.log("Done. Git preserved. Push from hoobot/ or run with --handoff for clean package.");
}
