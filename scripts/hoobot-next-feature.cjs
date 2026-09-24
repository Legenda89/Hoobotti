#!/usr/bin/env node
/**
 * Hoobot roadmap — seuraava kehityskohde.
 * Run: node scripts/hoobot-next-feature.cjs
 *      node scripts/hoobot-next-feature.cjs --json
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const roadmapPath = path.join(root, "hoobot-roadmap.json");
const promptPath = path.join(root, "scripts", "hoobot-automation-prompt.md");

function main() {
  const raw = fs.readFileSync(roadmapPath, "utf8");
  const roadmap = JSON.parse(raw);
  const pending = (roadmap.pending || []).slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const jsonOut = process.argv.includes("--json");

  if (!pending.length) {
    const msg = "Hoobot: roadmap tyhjä — lisää uusia kohteita hoobot-roadmap.json tiedostoon.";
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, message: msg, pending: [] }, null, 2));
    } else {
      console.log(msg);
    }
    process.exit(0);
  }

  const next = pending[0];
  const payload = {
    ok: true,
    id: next.id,
    title: next.title,
    description: next.description,
    priority: next.priority,
    files: [
      "hoobot-roadmap.json",
      "scripts/hoobot-automation-prompt.md",
      "src/Hoobot/Exchanges/Trades.ts",
      "src/Hoobot/Trading/liveOrderExecution.ts",
      "src/Hoobot/Utilities/Args.ts",
      "src/Frontend/index.html",
    ],
    automation: roadmap.automation || null,
    promptFile: "scripts/hoobot-automation-prompt.md",
  };

  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# Hoobot — seuraava kehityskohde: ${next.title} (${next.id})\n`);
  console.log(next.description);
  if (roadmap.automation && roadmap.automation.scheduleHuman) {
    console.log("\nAutomaatio: " + roadmap.automation.scheduleHuman);
  }
  console.log("\n## Agentille\n");
  console.log("1. Lue scripts/hoobot-automation-prompt.md");
  console.log("2. Toteuta roadmap-kohde `" + next.id + "`");
  console.log("3. Päivitä hoobot-roadmap.json (pending → completed)");
  console.log("\nTiedostot: " + payload.files.join(", "));
  if (fs.existsSync(promptPath)) {
    console.log("\n---\nLisäohjeet: " + promptPath);
  }
}

main();
