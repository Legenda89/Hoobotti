/**
 * node-binance-api WebSocket: lisää handshakeTimeout (60 s) Binance stream -yhteyksiin.
 * Ajetaan postinstallissa (idempotentti http-timeout-patchin jälkeen).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "node_modules", "node-binance-api", "node-binance-api.js");

if (!fs.existsSync(target)) {
  process.exit(0);
}

let s = fs.readFileSync(target, "utf8");
const orig = s;

const fnDef = `    const wsHandshakeTimeoutMs = () => {
        const o = Binance.options;
        return typeof o.wsHandshakeTimeout === 'number' && o.wsHandshakeTimeout > 0 ? o.wsHandshakeTimeout : 60000;
    };

`;

if (!s.includes("const wsHandshakeTimeoutMs")) {
  if (s.includes("const httpRequestTimeoutMs")) {
    s = s.replace(
      /(const httpRequestTimeoutMs = \(\) => \{[\s\S]*?\};\s*\n)/,
      `$1${fnDef}`
    );
  } else {
    s = s.replace(
      /( const addProxy = opt => \{[\s\S]*?    \}\s*\n)\s*(const reqHandler = cb =>)/,
      `$1${fnDef}    $2`
    );
  }
}

if (!s.includes("wsHandshakeTimeout: 60000")) {
  s = s.replace(
    /default_options = \{\s*\n\s*recvWindow: 5000,/,
    `default_options = {
        recvWindow: 5000,
        wsHandshakeTimeout: 60000,`
  );
}

if (!s.includes("Binance.options.wsHandshakeTimeout")) {
  s = s.replace(
    /if \( typeof Binance\.options\.httpRequestTimeout === 'undefined' \) Binance\.options\.httpRequestTimeout = default_options\.httpRequestTimeout;/,
    `if ( typeof Binance.options.httpRequestTimeout === 'undefined' ) Binance.options.httpRequestTimeout = default_options.httpRequestTimeout;
        if ( typeof Binance.options.wsHandshakeTimeout === 'undefined' ) Binance.options.wsHandshakeTimeout = default_options.wsHandshakeTimeout;`
  );
}

const wsOpts = "{ handshakeTimeout: wsHandshakeTimeoutMs() }";
const wsOptsAgent = "{ agent: agent, handshakeTimeout: wsHandshakeTimeoutMs() }";

s = s.replace(
  /ws = new WebSocket\( stream \+ endpoint \);/g,
  `ws = new WebSocket( stream + endpoint, ${wsOpts} );`
);
s = s.replace(
  /ws = new WebSocket\( stream \+ endpoint, \{ agent: agent \} \);/g,
  `ws = new WebSocket( stream + endpoint, ${wsOptsAgent} );`
);
s = s.replace(
  /ws = new WebSocket\( combineStream \+ queryParams \);/g,
  `ws = new WebSocket( combineStream + queryParams, ${wsOpts} );`
);
s = s.replace(
  /ws = new WebSocket\( combineStream \+ queryParams, \{ agent: agent \} \);/g,
  `ws = new WebSocket( combineStream + queryParams, ${wsOptsAgent} );`
);

if (s === orig) {
  if (s.includes("const wsHandshakeTimeoutMs")) {
    process.exit(0);
  }
  console.warn("[hoobot] node-binance-api WS handshake patch: no changes applied");
  process.exit(0);
}

fs.writeFileSync(target, s, "utf8");
console.log("[hoobot] applied node-binance-api WebSocket handshakeTimeout patch");
