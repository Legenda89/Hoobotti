const fs = require("fs");
const p = "e:/Hoobot/Hoobot15/src/index.ts";
let lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.includes('app.get("/api/live-status"'));
const end = lines.findIndex((l) => l.includes("/** Kryptot-sivun hinnat"));
if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}
lines.splice(start, end - start);
fs.writeFileSync(p, lines.join("\n"));
console.log("removed", end - start, "lines from", start);
