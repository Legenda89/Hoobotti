/**
 * Analysoi simulation/*/trades.json (viimeisin snapshot sisältää koko tradeHistory).
 * Usage: node scripts/analyze-sim-trades.cjs [path-to-trades.json]
 */
const fs = require("fs");
const path = require("path");

function findLatestTradesJson(root) {
  const simDir = path.join(root, "simulation");
  if (!fs.existsSync(simDir)) return null;
  let best = null;
  let bestM = 0;
  for (const name of fs.readdirSync(simDir)) {
    const fp = path.join(simDir, name, "trades.json");
    if (!fs.existsSync(fp)) continue;
    const m = fs.statSync(fp).mtimeMs;
    if (m > bestM) {
      bestM = m;
      best = fp;
    }
  }
  return best;
}

function pnlLong(entry, exit) {
  return ((exit - entry) / entry) * 100;
}
function pnlShort(entry, exit) {
  return ((entry - exit) / entry) * 100;
}

function analyze(historyBySymbol, feePct = 0.1) {
  const feeRt = feePct * 2;
  const out = {};
  for (const [sym, trades] of Object.entries(historyBySymbol || {})) {
    if (!Array.isArray(trades) || trades.length === 0) {
      out[sym] = { trades: 0 };
      continue;
    }
    const triggers = {};
    for (const t of trades) {
      const p = t.profit || "?";
      triggers[p] = (triggers[p] || 0) + 1;
    }
    const rounds = [];
    for (let i = 1; i < trades.length; i++) {
      const a = trades[i - 1];
      const b = trades[i];
      const pa = parseFloat(a.price);
      const pb = parseFloat(b.price);
      if (!(pa > 0 && pb > 0)) continue;
      let gross;
      if (a.isBuyer && !b.isBuyer) gross = pnlLong(pa, pb);
      else if (!a.isBuyer && b.isBuyer) gross = pnlShort(pa, pb);
      else continue;
      const net = gross - feeRt;
      rounds.push({
        net,
        gross,
        trigger: b.profit || "?",
        time: b.time,
        entry: pa,
        exit: pb,
      });
    }
    const wins = rounds.filter((r) => r.net > 0);
    const losses = rounds.filter((r) => r.net <= 0);
    const sum = (arr) => arr.reduce((s, r) => s + r.net, 0);
    const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
    const byTrigger = {};
    for (const r of rounds) {
      if (!byTrigger[r.trigger]) byTrigger[r.trigger] = { n: 0, sum: 0 };
      byTrigger[r.trigger].n += 1;
      byTrigger[r.trigger].sum += r.net;
    }
    const months = {};
    for (const r of rounds) {
      const d = new Date(r.time);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!months[key]) months[key] = { n: 0, sum: 0 };
      months[key].n += 1;
      months[key].sum += r.net;
    }
    out[sym] = {
      fills: trades.length,
      roundTrips: rounds.length,
      wins: wins.length,
      losses: losses.length,
      winRatePct: rounds.length ? (100 * wins.length) / rounds.length : 0,
      totalNetPct: sum(rounds),
      avgNetPct: avg(rounds),
      avgWinPct: avg(wins),
      avgLossPct: avg(losses),
      expectancyPct: rounds.length ? sum(rounds) / rounds.length : 0,
      profitFactor:
        Math.abs(sum(losses)) > 1e-9 ? sum(wins) / Math.abs(sum(losses)) : wins.length ? Infinity : 0,
      maxWinPct: wins.length ? Math.max(...wins.map((r) => r.net)) : 0,
      maxLossPct: losses.length ? Math.min(...losses.map((r) => r.net)) : 0,
      triggers,
      byCloseTrigger: Object.fromEntries(
        Object.entries(byTrigger).map(([k, v]) => [k, { n: v.n, avgNet: v.sum / v.n, sumNet: v.sum }])
      ),
      monthly: months,
      last5: rounds.slice(-5).map((r) => ({
        net: Number(r.net.toFixed(3)),
        trigger: r.trigger,
        time: new Date(r.time).toISOString(),
      })),
    };
  }
  return out;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const arg = process.argv[2];
  const fp = arg ? path.resolve(arg) : findLatestTradesJson(root);
  if (!fp || !fs.existsSync(fp)) {
    console.error("trades.json ei löytynyt");
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(fp, "utf8"));
  const hist = snap.tradeHistory || {};
  const analysis = analyze(hist, 0.1);
  const payload = {
    source: fp,
    snapshotSymbol: snap.symbol,
    analysis,
  };
  const outPath = path.join(root, "simulation", "sim-trade-analysis.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  console.error("Wrote", outPath);
}

main();
