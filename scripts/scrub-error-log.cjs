const fs = require("fs");
const path = require("path");
const targetArg = process.argv[2] || "logs/error.log";
const targetPath = path.resolve(process.cwd(), targetArg);

const REDACTED = "***REDACTED***";
const patterns = [
  /(X-MBX-APIKEY["':=\s]+)([A-Za-z0-9_-]+)/gi,
  /((?:api[-_]?key|secret|signature|authorization|token|passphrase)["':=\s]+)([^,\s"}\]]+)/gi,
];

function sanitizeLine(line) {
  let out = line;
  for (const re of patterns) {
    out = out.replace(re, (_, prefix) => `${prefix}${REDACTED}`);
  }
  return out;
}

async function scrubFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(dir, `${base}.backup-${stamp}`);
  const tempPath = path.join(dir, `${base}.tmp-${stamp}`);

  fs.copyFileSync(filePath, backupPath);

  const input = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  const output = fs.createWriteStream(tempPath, { encoding: "utf8" });
  let changed = 0;
  let carry = "";
  const tailSize = 256;

  await new Promise((resolve, reject) => {
    input.on("error", reject);
    output.on("error", reject);
    input.on("data", (chunk) => {
      const data = carry + chunk;
      if (data.length <= tailSize) {
        carry = data;
        return;
      }
      const writePart = data.slice(0, data.length - tailSize);
      carry = data.slice(data.length - tailSize);
      const next = sanitizeLine(writePart);
      if (next !== writePart) changed += 1;
      output.write(next);
    });
    input.on("end", () => {
      const tailOut = sanitizeLine(carry);
      if (tailOut !== carry) changed += 1;
      output.write(tailOut);
      output.end(() => resolve());
    });
  });

  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (err && err.code === "EPERM") {
      const fallback = `${filePath}.scrubbed`;
      fs.renameSync(tempPath, fallback);
      console.log(
        `Target file is locked, wrote scrubbed copy instead.\n` +
          `Locked target: ${filePath}\n` +
          `Scrubbed copy: ${fallback}\n` +
          `Backup: ${backupPath}`
      );
      return;
    }
    throw err;
  }
  console.log(
    `Scrubbed ${filePath}\n` +
      `Changed chunks: ${changed}\n` +
      `Backup: ${backupPath}`
  );
}

scrubFile(targetPath).catch((err) => {
  console.error("Scrub failed:", err);
  process.exit(1);
});
