/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
}

const defaultOptions: Required<RetryOptions> = { maxRetries: 3, delayMs: 1000 };

/**
 * Runs an async function and retries on failure with a delay.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const { maxRetries, delayMs } = { ...defaultOptions, ...options };
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
};
