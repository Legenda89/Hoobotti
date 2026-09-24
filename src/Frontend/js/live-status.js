/**
 * Dashboard live-status table (partial TP + counter-trend stats).
 * Loaded as classic script; exposes window.HoobotLiveStatus.
 */
(function (global) {
  function formatPartialTp(pt) {
    if (!pt) return "-";
    var first = pt.firstPartialToday ?? 0;
    var rem = pt.remainderCloseToday ?? 0;
    var full = pt.fullTpToday ?? 0;
    if (!first && !rem && !full) return "0";
    var parts = [first + " 1st", rem + " rem", full + " full"];
    if (pt.avgRemainderPnlPct != null) {
      parts.push("rem avg " + (pt.avgRemainderPnlPct > 0 ? "+" : "") + pt.avgRemainderPnlPct + "%");
    }
    return parts.join(" · ");
  }

  function formatCounterTrend(ct) {
    if (!ct) return "-";
    var n = ct.blockedToday ?? 0;
    if (!n) return "0";
    var detail = [];
    if (ct.buyIntoShortToday) detail.push("B←S " + ct.buyIntoShortToday);
    if (ct.sellIntoLongToday) detail.push("S←L " + ct.sellIntoLongToday);
    return detail.length ? n + " (" + detail.join(", ") + ")" : String(n);
  }

  function renderDashboardLiveStatus(rows) {
    var $tbody = $("#dashboard-live-table-body");
    $tbody.empty();
    if (!rows || !rows.length) {
      $tbody.html("<tr><td colspan='12' class='text-muted'>Ei live-symbolitietoja</td></tr>");
      return;
    }
    rows.forEach(function (row) {
      var current = row.currentOrder
        ? (row.currentOrder.side || "") +
          " " +
          (row.currentOrder.status || "") +
          " @ " +
          (row.currentOrder.price || "-")
        : "-";
      var lastTrade = row.lastTrade
        ? row.lastTrade.side + " @ " + row.lastTrade.price + " (" + row.lastTrade.ageMinutes + " min)"
        : "-";
      var tp = row.takeProfit
        ? (row.takeProfit.armed ? "armed" : "idle") + " peak " + (row.takeProfit.peak ?? "-")
        : "-";
      var guard = row.consecutiveLossGuard
        ? row.consecutiveLossGuard.active
          ? "estossa (skip " +
            (row.consecutiveLossGuard.skipRemaining ?? 0) +
            ", cd " +
            (row.consecutiveLossGuard.cooldownMinutes ?? 0) +
            " min)"
          : "vapaa"
        : "-";
      var slCd =
        row.stopLossCooldown && row.stopLossCooldown.active
          ? "SL-cd " + (row.stopLossCooldown.cooldownMinutes ?? 0) + " min"
          : "";
      var rateCd =
        row.tradeRateLimit && row.tradeRateLimit.active
          ? row.tradeRateLimit.reason || "rate-limit"
          : "";
      var staleCd = row.candleStale ? "stale candles" : "";
      var extras = [slCd, rateCd, staleCd].filter(Boolean).join(" · ");
      var guardText = extras ? guard + (guard !== "-" ? " · " : "") + extras : guard;
      var pnl =
        row.lastRoundTripPnl != null
          ? (row.lastRoundTripPnl > 0 ? "+" : "") + row.lastRoundTripPnl + "%"
          : "-";
      var position = row.hasOpenPosition ? "avoin" : "flat";
      if (row.hasOpenPosition && row.staleExit && row.staleExit.enabled) {
        position +=
          " · STALE " +
          (row.staleExit.ageHours ?? "-") +
          "/" +
          (row.staleExit.maxHours ?? "-") +
          " h";
      }
      var bal = row.balance
        ? row.balance.baseAsset +
          ": " +
          (row.balance.base ?? "-") +
          " / " +
          row.balance.quoteAsset +
          ": " +
          (row.balance.quote ?? "-")
        : "-";
      var partialTp = formatPartialTp(row.partialTp);
      var ctBlocks = formatCounterTrend(row.counterTrendBlocks);
      $tbody.append(
        "<tr>" +
          "<td>" +
          row.symbol +
          "</td>" +
          "<td>" +
          (row.exchangeMode || "") +
          "</td>" +
          "<td>" +
          position +
          "</td>" +
          "<td>" +
          current +
          "<br><small class=\"text-muted\">" +
          (row.liveOrderExecution || "") +
          "</small></td>" +
          "<td class=\"text-end\">" +
          (row.openOrders ?? 0) +
          "</td>" +
          "<td>" +
          lastTrade +
          "</td>" +
          "<td class=\"text-end\">" +
          pnl +
          "</td>" +
          "<td>" +
          tp +
          "</td>" +
          "<td><small>" +
          partialTp +
          "</small></td>" +
          "<td><small>" +
          ctBlocks +
          "</small></td>" +
          "<td><small>" +
          guardText +
          "</small></td>" +
          "<td><small>" +
          bal +
          "</small></td>" +
          "</tr>"
      );
    });
  }

  global.HoobotLiveStatus = {
    renderDashboardLiveStatus: renderDashboardLiveStatus,
    formatPartialTp: formatPartialTp,
    formatCounterTrend: formatCounterTrend,
  };
})(typeof window !== "undefined" ? window : globalThis);
