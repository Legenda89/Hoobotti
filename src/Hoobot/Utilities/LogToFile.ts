/* =====================================================================
* Hoobot - Proprietary License
* Copyright (c) 2023 Hoosat Oy. All rights reserved.
*
* Redistribution and use in source and binary forms, with or without
* modification, are not permitted without prior written permission
* from Hoosat Oy. Unauthorized reproduction, copying, or use of this
* software, in whole or in part, is strictly prohibited. All 
* modifications in source or binary must be submitted to Hoosat Oy in source format.
*
* THIS SOFTWARE IS PROVIDED BY HOOSAT OY "AS IS" AND ANY EXPRESS OR
* IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL HOOSAT OY BE LIABLE FOR ANY DIRECT,
* INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
* (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
* HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
* STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
* OF THE POSSIBILITY OF SUCH DAMAGE.
*
* The user of this software uses it at their own risk. Hoosat Oy shall
* not be liable for any losses, damages, or liabilities arising from
* the use of this software.
* ===================================================================== */

import fs from "fs";
import path from "path";

const SENSITIVE_KEY_RE = /(key|secret|signature|api[-_]?key|authorization|token|passphrase)/i;

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "***REDACTED***" : redactSensitive(v);
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .replace(/X-MBX-APIKEY["':=\s]+[A-Za-z0-9_-]+/gi, "X-MBX-APIKEY=***REDACTED***")
      .replace(/(api[-_]?key|secret|signature|authorization|token)["':=\s]+[^,\s"]+/gi, "$1=***REDACTED***");
  }
  return value;
};

export const safeStringifyForLogs = (value: unknown): string => {
  try {
    return JSON.stringify(redactSensitive(value), null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Append one line to a log file.
 * Uses synchronous I/O so thousands of rapid calls (e.g. simulation + DEBUG)
 * do not queue concurrent async opens and hit EMFILE (too many open files) on Windows.
 */
export const logToFile = async (logFilePath: string, logMessage: string): Promise<void> => {
  try {
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, "", "utf8");
    }
    fs.appendFileSync(logFilePath, `${logMessage}\n`, "utf8");
  } catch (err) {
    console.error("Error writing to log file:", logFilePath, err);
    /* Do not rethrow: avoids unhandled rejections when callers fire-and-forget, and prevents
       log-to-error.log cascades when the log file itself cannot be opened. */
  }
  return Promise.resolve();
};