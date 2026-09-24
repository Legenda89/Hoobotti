/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 * ===================================================================== */

/** Täysi täyttö: FILLED tai lähes koko määrä osittaisessa täytössä. */
export const FULL_FILL_RATIO = 0.999;

export function orderFillRatio(executedQty?: string | number, origQty?: string | number): number {
  const executed = typeof executedQty === "string" ? parseFloat(executedQty) : executedQty;
  const orig = typeof origQty === "string" ? parseFloat(origQty) : origQty;
  if (
    executed === undefined ||
    orig === undefined ||
    !Number.isFinite(executed) ||
    !Number.isFinite(orig) ||
    orig <= 0
  ) {
    return 0;
  }
  return executed / orig;
}

export function isFullOrderFill(status: string, executedQty?: string | number, origQty?: string | number): boolean {
  if (status === "FILLED") return true;
  if (status === "PARTIALLY_FILLED") {
    return orderFillRatio(executedQty, origQty) >= FULL_FILL_RATIO;
  }
  return false;
}

/** TP nollataan vain kun sulku-toimeksianto on täyttynyt (ei peruutuksessa). */
export function shouldClearTakeProfitAfterOrder(
  status: string,
  executedQty?: string | number,
  origQty?: string | number
): boolean {
  return isFullOrderFill(status, executedQty, origQty);
}

export function isTerminalOrderStatus(status: string): boolean {
  return ["FILLED", "CANCELED", "EXPIRED", "REJECTED", "DOES_NOT_EXIST"].includes(status);
}

/** Binance orderStatus → yhtenäinen status (osittainen 100 % → FILLED). */
export function normalizeExchangeOrderStatus(orderStatus: {
  status?: string;
  executedQty?: string;
  origQty?: string;
}): string {
  const status = orderStatus.status ?? "";
  if (isFullOrderFill(status, orderStatus.executedQty, orderStatus.origQty)) {
    return "FILLED";
  }
  return status;
}
