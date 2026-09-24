/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Express } from "express";
import type { ConfigOptions } from "../Hoobot/Utilities/Args";
import { toSymbolKey } from "../Hoobot/Utilities/Args";
import { getConsecutiveLossStatus, getStopLossCooldownStatus } from "../Hoobot/Trading/consecutiveLossGuard";
import { getTradeRateStatus } from "../Hoobot/Trading/churnGuard";
import { getPartialTpStatus } from "../Hoobot/Trading/partialTpStats";
import { getCounterTrendBlockStatus } from "../Hoobot/Trading/counterTrendStats";
import { getSymbolWsHealthSnapshot } from "../Hoobot/Utilities/botHealth";

export type HealthRouteDeps = {
  options: ConfigOptions;
  isSimulateInstance: boolean;
};

export const registerHealthRoutes = (app: Express, deps: HealthRouteDeps): void => {
  const { options, isSimulateInstance } = deps;

  app.get("/health", (_, res) => {
    const wsHealth = getSymbolWsHealthSnapshot();
    const symbols = [];
    for (const ex of options.exchanges ?? []) {
      for (const sym of ex.symbols ?? []) {
        const key = toSymbolKey(sym.name);
        const ws = wsHealth.find((h) => h.symbol.replace(/\//g, "") === key || toSymbolKey(h.symbol) === key);
        symbols.push({
          symbol: sym.name,
          exchange: ex.name,
          enabled: sym.enabled !== false,
          botRunning: options.running === true && ex.socket !== undefined,
          ws: ws
            ? {
                streams: ws.candleStreams,
                subscribedAt: ws.subscribedAt,
                lastCandleAt: ws.lastCandleAt,
                lastCandleAgeSec: ws.lastCandleAgeSec,
                stale: ws.stale === true,
                lastError: ws.lastError,
                lastErrorAt: ws.lastErrorAt,
              }
            : { streams: [], subscribedAt: undefined, stale: false },
          guards: {
            consecutiveLoss: getConsecutiveLossStatus(key),
            stopLossCooldown: getStopLossCooldownStatus(key),
            tradeRate: getTradeRateStatus(key, sym),
            partialTp: getPartialTpStatus(key),
            counterTrend: getCounterTrendBlockStatus(key),
          },
        });
      }
    }
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      simulateInstance: isSimulateInstance,
      running: options.running === true,
      symbols,
    });
  });
};
