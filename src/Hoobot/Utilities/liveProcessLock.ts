/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import { createServer } from "net";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "node:path";
import { findProjectRoot } from "./Args";

const probePortInUse = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code === "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    try {
      server.listen(port, "0.0.0.0");
    } catch {
      resolve(true);
    }
  });

/**
 * Estä kaksi live-hoobot-prosessia samaan aikaan (päällekkäiset market-tilaukset).
 * Tarkistaa sekä PID-tiedoston että HTTP-portin.
 */
export const acquireLiveProcessLock = async (port?: number): Promise<boolean> => {
  if (process.env.SIMULATE === "true") return true;
  if (process.env.HOOBOT_ALLOW_MULTI === "true") return true;

  const listenPort = port ?? Number(process.env.PORT || 5656);
  if (Number.isFinite(listenPort) && listenPort > 0) {
    const busy = await probePortInUse(listenPort);
    if (busy) {
      console.error(
        `[Hoobot] Portti ${listenPort} on jo käytössä — toinen live-prosessi todennäköisesti käynnissä. ` +
          `Sammuta se ennen uutta käynnistystä. (HOOBOT_ALLOW_MULTI=true ohittaa.)`
      );
      return false;
    }
  }

  const pidPath = join(findProjectRoot(), "settings", "hoobot-live.pid");
  try {
    if (existsSync(pidPath)) {
      const raw = readFileSync(pidPath, "utf-8").trim();
      const oldPid = parseInt(raw, 10);
      if (Number.isFinite(oldPid) && oldPid > 0 && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          console.error(
            `[Hoobot] Toinen live-prosessi on jo käynnissä (pid ${oldPid}). ` +
              `Sammuta se tai poista ${pidPath}. (HOOBOT_ALLOW_MULTI=true ohittaa.)`
          );
          return false;
        } catch {
          /* stale pid */
        }
      }
    }
    writeFileSync(pidPath, String(process.pid), "utf-8");
    const release = () => {
      try {
        if (existsSync(pidPath)) {
          const cur = readFileSync(pidPath, "utf-8").trim();
          if (cur === String(process.pid)) unlinkSync(pidPath);
        }
      } catch {
        /* ignore */
      }
    };
    process.once("exit", release);
    process.once("SIGINT", () => {
      release();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      release();
      process.exit(0);
    });
    return true;
  } catch (e) {
    console.warn("[Hoobot] PID-lukko epäonnistui:", e);
    return true;
  }
};
