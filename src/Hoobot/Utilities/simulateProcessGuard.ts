/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

import os from "os";

/**
 * Simulaatio voi pitää event loopin niin kiireisenä, että Windowsissa
 * näyttöjen herätys / DWM jumittuu idle-virranhallinnan jälkeen.
 * Laske prosessin prioriteetti ja anna OS:lle enemmän hengitystilaa.
 */
export const applySimulateProcessNice = (): void => {
  if (process.env.SIMULATE !== "true") return;
  if (process.env.SIM_KEEP_PRIORITY === "true") return;
  try {
    // Windows: BELOW_NORMAL ≈ 1; Unix: positive nice = lower priority
    const p = process.platform === "win32" ? 1 : 10;
    os.setPriority(0, p);
    console.log(
      "[simulate] Prosessin prioriteetti laskettu (BELOW_NORMAL) — näytöt/OS saavat CPU-aikaa. " +
        "SIM_KEEP_PRIORITY=true ohittaa."
    );
  } catch (e) {
    console.warn("[simulate] Prioriteetin asetus epäonnistui:", e);
  }
};

/** Yield event loopille. Timer-yield päästää Windows DWM:n heräämään paremmin kuin pelkkä setImmediate. */
export const yieldToEventLoop = (useTimer: boolean = false): Promise<void> =>
  new Promise((resolve) => {
    if (useTimer) setTimeout(resolve, 1);
    else setImmediate(resolve);
  });

export type SimYieldConfig = {
  everyCandles: number;
  everyMs: number;
  /** Kuinka usein käytetään setTimeout(1) setImmediate:n sijaan. */
  timerEveryNYields: number;
};

export const resolveSimYieldConfig = (): SimYieldConfig => {
  const everyCandles = Number(process.env.SIM_YIELD_EVERY_CANDLES);
  const everyMs = Number(process.env.SIM_YIELD_EVERY_MS);
  const timerEvery = Number(process.env.SIM_YIELD_TIMER_EVERY);
  return {
    everyCandles: Number.isFinite(everyCandles) && everyCandles >= 10 ? Math.floor(everyCandles) : 50,
    everyMs: Number.isFinite(everyMs) && everyMs >= 5 ? Math.floor(everyMs) : 25,
    timerEveryNYields: Number.isFinite(timerEvery) && timerEvery >= 1 ? Math.floor(timerEvery) : 4,
  };
};
