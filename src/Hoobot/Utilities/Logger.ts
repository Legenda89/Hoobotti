/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

let minLevel: LogLevel = "info";
try {
  if (process.env.DEBUG === "true" || process.env.LOG_LEVEL === "debug") minLevel = "debug";
  else if (process.env.LOG_LEVEL === "warn") minLevel = "warn";
  else if (process.env.LOG_LEVEL === "error") minLevel = "error";
} catch {
  // ignore
}

const shouldLog = (level: LogLevel): boolean =>
  LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);

export const setMinLogLevel = (level: LogLevel): void => {
  minLevel = level;
};

export const logger = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) console.log("[debug]", ...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("warn")) console.warn("[warn]", ...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) console.error("[error]", ...args);
  },
};
