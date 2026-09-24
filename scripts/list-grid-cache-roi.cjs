const fs = require("fs");
const path = require("path");

const cacheDir = path.join(__dirname, "..", "simulation", "cache", "grid-variants");
const rows = [];
for (const name of fs.readdirSync(cacheDir)) {
  if (!name.endsWith(".json")) continue;
  const p = path.join(cacheDir, name);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const r = j?.result;
  if (!r?.ok) continue;
  const roi = Number(r.roi);
  rows.push({
    cacheFile: name,
    savedAt: j.savedAt,
    variantIndex: j.variantIndex,
    roi,
    roiPercent: r.roiPercent,
    finalPortfolio: r.finalPortfolio,
    candleRows: r.candleRows,
  });
}
rows.sort((a, b) => b.roi - a.roi);
const band = rows.filter((r) => r.roi >= 2.7 && r.roi <= 3.0);
console.log("ROI 270–300%:", JSON.stringify(band, null, 2));
console.log("\nTop 5 cache ROI:");
console.log(JSON.stringify(rows.slice(0, 5), null, 2));
