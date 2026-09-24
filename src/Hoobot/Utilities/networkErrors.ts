/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/** Verkko-/WebSocket-virheet joita botti yleensä selviää uudelleenyhdistämisellä. */
export const isTransientNetworkError = (err: Error | string): boolean => {
  const m = typeof err === "string" ? err : err.message ?? "";
  return (
    m.includes("Opening handshake has timed out") ||
    m.includes("ECONNRESET") ||
    m.includes("ECONNREFUSED") ||
    m.includes("ETIMEDOUT") ||
    m.includes("EAI_AGAIN") ||
    m.includes("ESOCKETTIMEDOUT") ||
    m.includes("socket hang up")
  );
};
