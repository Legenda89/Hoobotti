/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import fs from "fs";
import path from "path";
import type { Express, Response } from "express";
import type { ConfigOptions, SymbolOptions } from "../Hoobot/Utilities/Args";
import { sanitizeOptionsDocument } from "../Hoobot/Utilities/Args";

export type ApplySummaryVariantResult =
  | { ok: true; appliedSymbols: string[]; basename: string }
  | { ok: false; status: number; error: string };

export type ApplySummaryVariantBody = {
  exchangeName?: string;
  targetSymbolName?: string;
  applyToAll?: boolean;
  variant?: unknown;
  flatValues?: Record<string, unknown>;
  values?: Record<string, unknown>;
  baselineOptionsSnapshotFile?: unknown;
};

export type SettingsAdminRouteDeps = {
  isSimulateInstance: boolean;
  liveOptionsFilename: string;
  optionsFilename: string;
  simToLivePushCors: (res: Response) => void;
  applySummaryVariantToHoobotJsonFile: (
    targetFilePath: string,
    body: ApplySummaryVariantBody
  ) => ApplySummaryVariantResult;
  restartLiveHoobotFromDisk: () => void;
  readPersistedBaselineExchanges: (snapFromBody: string) => ConfigOptions | undefined;
};

const readSymbolListFromOptionsFile = (
  readPath: string
): { ok: true; exchanges: Array<{ name: string; symbols: Array<{ name: string }> }>; basename: string } | { ok: false; error: string } => {
  try {
    if (!fs.existsSync(readPath)) {
      return { ok: true, exchanges: [], basename: path.basename(readPath) };
    }
    const raw = fs.readFileSync(readPath, "utf-8");
    const doc = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const exchanges = Array.isArray(doc.exchanges) ? doc.exchanges : [];
    const out: Array<{ name: string; symbols: Array<{ name: string }> }> = [];
    for (const ex of exchanges) {
      if (!ex || typeof ex !== "object") continue;
      const e = ex as { name?: string; symbols?: SymbolOptions[] };
      const symbols = Array.isArray(e.symbols)
        ? e.symbols.filter((s) => s && s.name).map((s) => ({ name: String(s.name) }))
        : [];
      out.push({ name: String(e.name ?? ""), symbols });
    }
    return { ok: true, exchanges: out, basename: path.basename(readPath) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Symbol lists, sim→live apply, remote apply, live restart. */
export const registerSettingsAdminRoutes = (app: Express, deps: SettingsAdminRouteDeps): void => {
  const {
    isSimulateInstance,
    liveOptionsFilename,
    optionsFilename,
    simToLivePushCors,
    applySummaryVariantToHoobotJsonFile,
    restartLiveHoobotFromDisk,
    readPersistedBaselineExchanges,
  } = deps;

  app.options("/settings/live-symbols", (_, res) => {
    simToLivePushCors(res);
    res.sendStatus(204);
  });

  app.get("/settings/live-symbols", (_, res) => {
    simToLivePushCors(res);
    const readPath = isSimulateInstance ? liveOptionsFilename : optionsFilename;
    const out = readSymbolListFromOptionsFile(readPath);
    if (!out.ok) {
      console.error("live-symbols:", out.error);
      res.status(500).json({ ok: false, error: "Live-symbolien luku epäonnistui." });
      return;
    }
    res.json({ ok: true, exchanges: out.exchanges });
  });

  app.options("/settings/simulate-symbols", (_, res) => {
    simToLivePushCors(res);
    res.sendStatus(204);
  });

  app.get("/settings/simulate-symbols", (_, res) => {
    simToLivePushCors(res);
    if (!isSimulateInstance) {
      res.status(403).json({ ok: false, error: "Vain simulaatio-istunnossa (SIMULATE=true)." });
      return;
    }
    const out = readSymbolListFromOptionsFile(optionsFilename);
    if (!out.ok) {
      console.error("simulate-symbols:", out.error);
      res.status(500).json({ ok: false, error: "Simulaatio-symbolien luku epäonnistui." });
      return;
    }
    res.json({ ok: true, exchanges: out.exchanges, basename: out.basename });
  });

  app.options("/settings/apply-summary-variant-to-simulate", (_, res) => {
    simToLivePushCors(res);
    res.sendStatus(204);
  });

  app.post("/settings/apply-summary-variant-to-simulate", (req, res) => {
    simToLivePushCors(res);
    if (!isSimulateInstance) {
      res.status(403).json({ ok: false, error: "Vain simulaatio-istunnossa." });
      return;
    }
    try {
      const body = req.body as ApplySummaryVariantBody;
      const targetPath = optionsFilename;
      const out = applySummaryVariantToHoobotJsonFile(targetPath, body);
      if (!out.ok) {
        res.status(out.status).json({
          ok: false,
          error:
            out.status === 400
              ? out.error.replace(/^Asetustiedostoa/, "Simulaatio-asetustiedostoa")
              : out.error,
        });
        return;
      }
      res.json({
        ok: true,
        message: `Kirjoitettu ${out.appliedSymbols.length} parille (${out.appliedSymbols.join(", ")}) → ${path.basename(targetPath)}. Seuraava simulaatio käyttää näitä.`,
        appliedSymbols: out.appliedSymbols,
        basename: out.basename,
      });
    } catch (e) {
      console.error("apply-summary-variant-to-simulate:", e);
      res.status(500).json({ ok: false, error: "Siirto simulaatioasetuksiin epäonnistui." });
    }
  });

  app.post("/settings/apply-summary-variant-to-live", (req, res) => {
    if (!isSimulateInstance) {
      res.status(403).json({ ok: false, error: "Vain simulaatio-istunnossa." });
      return;
    }
    try {
      const body = req.body as ApplySummaryVariantBody;
      const out = applySummaryVariantToHoobotJsonFile(liveOptionsFilename, body);
      if (!out.ok) {
        res.status(out.status).json({
          ok: false,
          error: out.status === 400 ? out.error.replace(/^Asetustiedostoa/, "Live-asetustiedostoa") : out.error,
        });
        return;
      }
      res.json({
        ok: true,
        message: `Siirretty ${out.appliedSymbols.length} parille (${out.appliedSymbols.join(", ")}) → ${path.basename(liveOptionsFilename)}.`,
        appliedSymbols: out.appliedSymbols,
        liveRestartPending: true,
        hint: "Etä-botille käytä suoraa lähetystä tai POST /live/restart live-osoitteesta.",
      });
    } catch (e) {
      console.error("apply-summary-variant-to-live:", e);
      res.status(500).json({ ok: false, error: "Siirto epäonnistui." });
    }
  });

  app.post("/settings/apply-simulate-last-baseline-exchanges-to-live", (req, res) => {
    if (!isSimulateInstance) {
      res.status(403).json({ ok: false, error: "Vain simulaatio-istunnossa." });
      return;
    }
    try {
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as { baselineOptionsSnapshotFile?: unknown })
          : {};
      const snapFromBody =
        typeof body.baselineOptionsSnapshotFile === "string" ? body.baselineOptionsSnapshotFile.trim() : "";
      const baseline = readPersistedBaselineExchanges(snapFromBody);
      if (!baseline || !Array.isArray(baseline.exchanges) || baseline.exchanges.length === 0) {
        res.status(400).json({
          ok: false,
          error: snapFromBody
            ? "Baseline-snapshot-tiedostosta ei löytynyt exchanges-listaa."
            : "Tallennetussa tuloksessa ei ole baselineConfig.exchanges -osiota. Aja simulaatio uudelleen (SIMULATE=true) jotta baseline tallentuu.",
        });
        return;
      }
      if (!fs.existsSync(liveOptionsFilename)) {
        res.status(400).json({
          ok: false,
          error: "Live-asetustiedostoa ei löydy: " + path.basename(liveOptionsFilename),
        });
        return;
      }
      const rawLive = fs.readFileSync(liveOptionsFilename, "utf-8");
      const liveDoc = (rawLive ? JSON.parse(rawLive) : {}) as Record<string, unknown>;
      liveDoc.exchanges = JSON.parse(JSON.stringify(baseline.exchanges)) as unknown[];
      fs.writeFileSync(
        liveOptionsFilename,
        JSON.stringify(sanitizeOptionsDocument(liveDoc as ConfigOptions), null, 2)
      );
      res.json({
        ok: true,
        message: `Live-tiedoston exchanges korvattu baselin mukaan (${baseline.exchanges.length} pörssiä) → ${path.basename(liveOptionsFilename)}.`,
        liveRestartPending: true,
        hint: "Käynnistä live-botti uudelleen (tai POST /live/restart) jotta muutos astuu voimaan.",
      });
    } catch (e) {
      console.error("apply-simulate-last-baseline-exchanges-to-live:", e);
      res.status(500).json({ ok: false, error: "Siirto epäonnistui." });
    }
  });

  app.options("/settings/remote-apply-summary-variant", (_, res) => {
    simToLivePushCors(res);
    res.sendStatus(204);
  });

  app.post("/settings/remote-apply-summary-variant", (req, res) => {
    simToLivePushCors(res);
    if (isSimulateInstance) {
      res.status(403).json({
        ok: false,
        error:
          "Tämä komento on vain live-prosessissa. Simulaatioprosessissa käytä ”paikallista kopioita” tai kutsua live-botin osoitteesta.",
      });
      return;
    }
    const expectedKey = (process.env.HOOBOT_APPLY_KEY ?? "").trim();
    if (expectedKey) {
      const got = (req.header("x-hoobot-apply-key") ?? "").trim();
      if (got !== expectedKey) {
        res.status(401).json({
          ok: false,
          error: "Puuttuva tai väärä X-Hoobot-Apply-Key (livessä HOOBOT_APPLY_KEY).",
        });
        return;
      }
    }
    try {
      const body = req.body as ApplySummaryVariantBody;
      const out = applySummaryVariantToHoobotJsonFile(optionsFilename, body);
      if (!out.ok) {
        res.status(out.status).json({ ok: false, error: out.error });
        return;
      }
      restartLiveHoobotFromDisk();
      res.json({
        ok: true,
        message: `Siirretty ${out.appliedSymbols.length} parille (${out.appliedSymbols.join(", ")}) ja live käynnistettiin uudelleen (${out.basename}).`,
        appliedSymbols: out.appliedSymbols,
        restarted: true,
      });
    } catch (e) {
      console.error("remote-apply-summary-variant:", e);
      res.status(500).json({ ok: false, error: "Etäsiirto tai uudelleiskäynnistys epäonnistui." });
    }
  });

  app.options("/live/restart", (_, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hoobot-Apply-Key");
    res.sendStatus(204);
  });

  app.post("/live/restart", (_, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (isSimulateInstance) {
      res.status(403).json({
        ok: false,
        error:
          "Tämä on simulaatiopalvelin. Käynnistä live-botti erillisessä Hoobot-prosessissa (SIMULATE ei asetettu), tai kutsu tämä endpointti live-portista (esim. 5656).",
      });
      return;
    }
    try {
      restartLiveHoobotFromDisk();
      res.json({ ok: true, message: "Live-botti käynnistetty uudelleen." });
    } catch (e) {
      console.error("live/restart:", e);
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
};
