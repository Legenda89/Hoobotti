/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import type { Express } from "express";
import { getLastCandlesticks } from "../Hoobot/Exchanges/Candlesticks";
import { getOpenOrders } from "../Hoobot/Exchanges/Orders";
import { getTradeHistory, calculatePNLPercentageForLong, calculatePNLPercentageForShort } from "../Hoobot/Exchanges/Trades";
import { getTakeProfitRuntimeState } from "../Hoobot/Indicators/takeProfitPositionState";
import {
  getConsecutiveLossStatus,
  getStopLossCooldownStatus,
  lastCompletedRoundTripPnlPct,
} from "../Hoobot/Trading/consecutiveLossGuard";
import { getTradeRateStatus } from "../Hoobot/Trading/churnGuard";
import { getPartialTpStatus } from "../Hoobot/Trading/partialTpStats";
import { getCounterTrendBlockStatus } from "../Hoobot/Trading/counterTrendStats";
import { isSymbolCandleStale } from "../Hoobot/Utilities/botHealth";
import { hasOpenAlgorithmicPosition } from "../Hoobot/Trading/positionState";
import { toSymbolKey } from "../Hoobot/Utilities/Args";
import {
  candleLimitForDuration,
  computeOpenPositionSnapshot,
  computeStaleExitStatus,
  durationToChartInterval,
  getTargetTimestamp,
  loadTradesForChart,
  netUnrealizedPctAtMark,
  type DashboardRouteDeps,
} from "./dashboardHelpers";

export const registerDashboardRoutes = (app: Express, deps: DashboardRouteDeps): void => {
  const {
    options,
    isSimulateInstance,
    resolveDashboardExchange,
    pnlCacheByKey,
    priceChartCacheByKey,
    PNL_CACHE_MS,
    PRICE_CHART_CACHE_MS,
    roundTripPnlAfterFees,
    logger,
  } = deps;

  app.get("/api/live-status", async (req, res) => {
    try {
      if (isSimulateInstance) {
        res.json({
          ok: true,
          simulationUi: true,
          timestamp: new Date().toISOString(),
          symbols: [],
          hint: "Live-tilannekuva on käytössä vain live-prosessissa.",
        });
        return;
      }
      const exchangeName = String((req.query.exchange as string | undefined) ?? options.exchanges[0]?.name ?? "");
      const exchangeOptions = options.exchanges.find((e) => e.name === exchangeName);
      if (!exchangeOptions) {
        res.status(400).json({ ok: false, error: `Exchange '${exchangeName}' not found in settings` });
        return;
      }
      const exchange = exchangeOptions.socket;
      const symbols = [];
      for (const sym of exchangeOptions.symbols ?? []) {
        const symbolKey = toSymbolKey(sym.name);
        const [baseAsset, quoteAsset] = sym.name.split("/");
        const currentOrder = sym.currentOrder
          ? {
              id: sym.currentOrder.orderId,
              status: sym.currentOrder.orderStatus,
              side: sym.currentOrder.isBuyer ? "BUY" : "SELL",
              price: sym.currentOrder.price,
              qty: sym.currentOrder.qty,
            }
          : undefined;
        let openOrderCount: number | undefined;
        if (exchange) {
          try {
            openOrderCount = (await getOpenOrders(exchange, sym.name)).length;
          } catch {
            openOrderCount = undefined;
          }
        }
        const history = exchangeOptions.tradeHistory?.[symbolKey] ?? [];
        const lastTrade = history[history.length - 1];
        const tpSell = getTakeProfitRuntimeState(symbolKey, "sell");
        const tpBuy = getTakeProfitRuntimeState(symbolKey, "buy");
        const lossGuard = getConsecutiveLossStatus(symbolKey);
        const slCooldown = getStopLossCooldownStatus(symbolKey);
        const tradeRate = getTradeRateStatus(symbolKey, sym);
        const candleStale = isSymbolCandleStale(symbolKey);
        const partialTp = getPartialTpStatus(symbolKey);
        const counterTrend = getCounterTrendBlockStatus(symbolKey);
        const lastRoundTripPnl = lastCompletedRoundTripPnlPct(history, sym.tradeFeePercentage);
        const hasOpenPosition = hasOpenAlgorithmicPosition(history, symbolKey);
        const staleExit = computeStaleExitStatus(sym.forcedExit, lastTrade?.time, hasOpenPosition);
        symbols.push({
          symbol: sym.name,
          enabled: sym.enabled !== false,
          exchangeMode: exchangeOptions.mode,
          running: options.running === true && exchange !== undefined,
          hasOpenPosition,
          liveOrderExecution: `buy=${sym.liveOrderExecution?.buy ?? "default"}, sell=${sym.liveOrderExecution?.sell ?? "default"}`,
          currentOrder,
          openOrders: openOrderCount ?? (currentOrder ? 1 : 0),
          lastTrade: lastTrade
            ? {
                side: lastTrade.isBuyer ? "BUY" : "SELL",
                price: lastTrade.price,
                qty: lastTrade.qty,
                time: lastTrade.time,
                ageMinutes: Math.max(0, Math.round((Date.now() - lastTrade.time) / 60000)),
              }
            : undefined,
          lastRoundTripPnl: lastRoundTripPnl != null ? Number(lastRoundTripPnl.toFixed(3)) : undefined,
          takeProfit: {
            armed: tpSell.armed || tpBuy.armed,
            peak: Math.max(tpSell.peakUnrealizedPct ?? 0, tpBuy.peakUnrealizedPct ?? 0),
          },
          consecutiveLossGuard: {
            active: lossGuard.active,
            skipRemaining: lossGuard.skipRemaining,
            cooldownMinutes: lossGuard.cooldownRemainingMinutes,
          },
          stopLossCooldown: {
            active: slCooldown.active,
            cooldownMinutes: slCooldown.cooldownRemainingMinutes,
          },
          tradeRateLimit: {
            active: tradeRate.active,
            tradesToday: tradeRate.tradeCountToday,
            maxTradesPerDay: tradeRate.maxTradesPerDay,
            minutesSinceEntry: tradeRate.minutesSinceLastEntry,
            minMinutesBetweenEntries: tradeRate.minMinutesBetweenEntries,
            reason: tradeRate.reason,
          },
          partialTp,
          counterTrendBlocks: counterTrend,
          candleStale,
          staleExit,
          balance:
            baseAsset && quoteAsset
              ? {
                  baseAsset,
                  quoteAsset,
                  base: exchangeOptions.balances?.[baseAsset]?.crypto,
                  quote: exchangeOptions.balances?.[quoteAsset]?.crypto,
                }
              : undefined,
        });
      }
      res.json({ ok: true, exchange: exchangeOptions.name, timestamp: new Date().toISOString(), symbols });
    } catch (e) {
      logger.error("Error in /api/live-status", e);
      res.status(500).json({ ok: false, error: "Failed to load live status", details: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/pnl", async (req, res) => {
    try {
      if (isSimulateInstance) {
        res.json({
          summary: [],
          duration: String((req.query.duration as string | undefined) ?? "1D").toUpperCase(),
          simulationUi: true,
          hint: "PNL-dashboard ei käytä Binance API -avaimia simulaatio-istunnossa.",
        });
        return;
      }
      const exchangeName = (req.query.exchange as string | undefined) ?? options.exchanges[0]?.name;
      const duration = (req.query.duration as string | undefined) ?? "1D";
      if (!exchangeName) {
        res.status(400).json({ error: "No exchanges configured" });
        return;
      }

      const cacheKey = `${exchangeName}|${String(duration).toUpperCase()}`;
      const cached = pnlCacheByKey[cacheKey];
      if (cached && Date.now() - cached.at < PNL_CACHE_MS) {
        res.json(cached.data);
        return;
      }

      const resolved = await resolveDashboardExchange(exchangeName);
      if ("error" in resolved) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }
      const { exchange, exchangeOptions } = resolved;

      const symbols = exchangeOptions.symbols ?? [];
      const summary: Array<{ symbol: string; trades: number; pnlPercentage: number }> = [];
      const targetTimestamp = getTargetTimestamp(String(duration).toUpperCase());

      for (const symbolOptions of symbols) {
        try {
          const symbolKey = toSymbolKey(symbolOptions.name);
          const existing = exchangeOptions.tradeHistory?.[symbolKey];

          let tradesInDuration = [];

          if (Array.isArray(existing) && existing.length > 0) {
            const tradesAfter = existing.filter((t) => t.time / 1000 >= targetTimestamp);
            const tradesBefore = existing.filter((t) => t.time / 1000 < targetTimestamp);
            const prev = tradesBefore[tradesBefore.length - 1];
            tradesInDuration = prev ? [prev, ...tradesAfter] : tradesAfter;
          } else {
            const tradeHistory = await getTradeHistory(exchange, symbolOptions.name);
            const tradesAfter = tradeHistory.filter((t) => t.time / 1000 >= targetTimestamp);
            const tradesBefore = tradeHistory.filter((t) => t.time / 1000 < targetTimestamp);
            const prev = tradesBefore[tradesBefore.length - 1];
            tradesInDuration = prev ? [prev, ...tradesAfter] : tradesAfter;
          }

          if (tradesInDuration.length < 2) {
            summary.push({ symbol: symbolOptions.name, trades: tradesInDuration.length, pnlPercentage: 0 });
            continue;
          }

          let pnlPercentage = 0;
          for (let i = 1; i < tradesInDuration.length; i++) {
            const olderTrade = tradesInDuration[i - 1];
            const lastTrade = tradesInDuration[i];
            let lastPNL = 0;
            if (olderTrade.isBuyer) {
              lastPNL = calculatePNLPercentageForLong(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
            } else {
              lastPNL = calculatePNLPercentageForShort(parseFloat(olderTrade.price), parseFloat(lastTrade.price));
            }

            pnlPercentage += roundTripPnlAfterFees(
              lastPNL,
              olderTrade,
              lastTrade,
              symbolOptions.tradeFeePercentage
            );
          }

          summary.push({
            symbol: symbolOptions.name,
            trades: tradesInDuration.length,
            pnlPercentage: Number(pnlPercentage.toFixed(2)),
          });
        } catch (e) {
          logger.error("Failed to calculate PNL for symbol", symbolOptions.name, e);
          summary.push({ symbol: symbolOptions.name, trades: 0, pnlPercentage: 0 });
        }
      }

      const out = {
        exchange: exchangeOptions.name,
        duration: String(duration).toUpperCase(),
        summary,
      };
      pnlCacheByKey[cacheKey] = { at: Date.now(), data: out };
      res.json(out);
    } catch (e) {
      logger.error("Error in /api/pnl", e);
      res.status(500).json({ error: "Failed to calculate PNL", details: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/dashboard/price-chart", async (req, res) => {
    try {
      if (isSimulateInstance) {
        res.json({
          ok: false,
          simulationUi: true,
          hint: "Hintakäyrä vaatii live-prosessin ja Binance/NonKYC-yhteyden.",
          candles: [],
          trades: [],
        });
        return;
      }

      const exchangeName = (req.query.exchange as string | undefined) ?? options.exchanges[0]?.name;
      const symbol = String((req.query.symbol as string | undefined) ?? "").trim();
      const duration = String((req.query.duration as string | undefined) ?? "1D").toUpperCase();
      if (!exchangeName || !symbol) {
        res.status(400).json({ ok: false, error: "exchange and symbol required" });
        return;
      }

      const cacheKey = `${exchangeName}|${symbol}|${duration}`;
      const cached = priceChartCacheByKey[cacheKey];
      if (cached && Date.now() - cached.at < PRICE_CHART_CACHE_MS) {
        res.json(cached.data);
        return;
      }

      const resolved = await resolveDashboardExchange(exchangeName);
      if ("error" in resolved) {
        res.status(resolved.status).json({ ok: false, error: resolved.error });
        return;
      }
      const { exchange, exchangeOptions } = resolved;

      const symOpt = (exchangeOptions.symbols ?? []).find((s) => s.name === symbol);
      if (!symOpt) {
        res.status(400).json({ ok: false, error: `Symbol '${symbol}' not found` });
        return;
      }

      const interval = durationToChartInterval(duration);
      const limit = candleLimitForDuration(duration);
      const targetMs = getTargetTimestamp(duration) * 1000;

      let candles: Array<{ time: number; open: number; high: number; low: number; close: number }> = [];
      try {
        const raw = await getLastCandlesticks(exchange, symbol, interval, limit);
        candles = raw
          .filter((c) => (c.startTime ?? c.time) >= targetMs)
          .map((c) => ({
            time: c.startTime ?? c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
      } catch (e) {
        logger.error("price-chart candles failed", symbol, e);
      }

      const trades = await loadTradesForChart(exchange, exchangeOptions, symbol, duration);
      const markPrice = candles.length ? candles[candles.length - 1]!.close : undefined;
      const position = computeOpenPositionSnapshot(trades, markPrice, symOpt.tradeFeePercentage, toSymbolKey(symbol));

      const unrealizedSeries: Array<{ time: number; pct: number }> = [];
      if (position.open && position.entryTime != null && position.entryPrice != null && candles.length) {
        const lastTrade = trades[trades.length - 1];
        for (const c of candles) {
          if (c.time < position.entryTime) continue;
          const net = netUnrealizedPctAtMark(
            position.entryPrice,
            c.close,
            position.side ?? "LONG",
            symOpt.tradeFeePercentage,
            lastTrade
          );
          unrealizedSeries.push({ time: c.time, pct: Number(net.toFixed(3)) });
        }
      }

      const out = {
        ok: true,
        exchange: exchangeName,
        symbol,
        duration,
        interval,
        chartType: duration === "1D" ? "candlestick" : "line",
        candles,
        position,
        unrealizedSeries,
        trades: trades.map((t) => ({
          time: t.time,
          price: parseFloat(t.price),
          qty: parseFloat(t.qty),
          side: t.isBuyer ? "BUY" : "SELL",
          trigger: t.profit ?? undefined,
          orderId: t.orderId,
        })),
      };
      priceChartCacheByKey[cacheKey] = { at: Date.now(), data: out };
      res.json(out);
    } catch (e) {
      logger.error("Error in /api/dashboard/price-chart", e);
      res.status(500).json({
        ok: false,
        error: "Failed to load price chart",
        details: e instanceof Error ? e.message : String(e),
      });
    }
  });
};
