/**
 * node-binance-api käyttää recvWindow-arvoa myös HTTP-pyynnön timeoutina (ms).
 * Binancen recvWindow on max 60000 — hitaalla verkolla ESOCKETTIMEDOUT.
 * Tämä skripti erottaa HTTP-timeoutin (httpRequestTimeout, oletus 120 s) recvWindow:sta.
 * Ajetaan postinstallissa (toimii ilman git / patch-packagea).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "node_modules", "node-binance-api", "node-binance-api.js");

if (!fs.existsSync(target)) {
  process.exit(0);
}

let s = fs.readFileSync(target, "utf8");
if (s.includes("httpRequestTimeoutMs")) {
  process.exit(0);
}

const orig = s;

s = s.replace(
  /const default_options = \{\s*\n\s*recvWindow: 5000,\s*\n\s*useServerTime: false,/,
  `const default_options = {
        recvWindow: 5000,
        httpRequestTimeout: 120000,
        useServerTime: false,`
);

s = s.replace(
  /if \( typeof Binance\.options\.recvWindow === 'undefined' \) Binance\.options\.recvWindow = default_options\.recvWindow;\s*\n(\s*if \( typeof Binance\.options\.useServerTime)/,
  `if ( typeof Binance.options.recvWindow === 'undefined' ) Binance.options.recvWindow = default_options.recvWindow;
        if ( typeof Binance.options.httpRequestTimeout === 'undefined' ) Binance.options.httpRequestTimeout = default_options.httpRequestTimeout;
$1`
);

const injectFn = `    const httpRequestTimeoutMs = () => {
        const o = Binance.options;
        return typeof o.httpRequestTimeout === 'number' && o.httpRequestTimeout > 0 ? o.httpRequestTimeout : o.recvWindow;
    };

`;

s = s.replace(
  /( const addProxy = opt => \{[\s\S]*?    \}\s*\n)\s*(const reqHandler = cb =>)/,
  `$1${injectFn}    $2`
);

s = s.replace(/timeout: Binance\.options\.recvWindow/g, "timeout: httpRequestTimeoutMs()");

if (s === orig) {
  console.warn("[hoobot] node-binance-api HTTP timeout patch: no changes applied (unexpected file format?)");
  process.exit(0);
}

fs.writeFileSync(target, s, "utf8");
console.log("[hoobot] applied node-binance-api HTTP timeout patch (httpRequestTimeout / httpRequestTimeoutMs)");
