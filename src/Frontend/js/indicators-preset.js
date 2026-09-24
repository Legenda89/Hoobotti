/**
 * Indicator paradigm presets for Settings UI (mean-reversion vs momentum).
 * Loaded as classic script; exposes window.HoobotIndicatorsPreset.
 */
(function (global) {
  function setChk($symbol, sel, on) {
    $symbol.find(sel).prop("checked", !!on);
  }

  function applyMeanReversion($symbol) {
    setChk($symbol, ".sma-enabled", false);
    setChk($symbol, ".renko-enabled", false);
    setChk($symbol, ".ema-enabled", false);
    setChk($symbol, ".macd-enabled", false);
    setChk($symbol, ".rsi-enabled", true);
    setChk($symbol, ".adx-enabled", false);
    setChk($symbol, ".atr-enabled", true);
    setChk($symbol, ".obv-enabled", false);
    setChk($symbol, ".cmf-enabled", true);
    setChk($symbol, ".bb-enabled", true);
    setChk($symbol, ".so-enabled", false);
    setChk($symbol, ".srsi-enabled", false);
    setChk($symbol, ".dmi-enabled", false);
    $symbol.find(".rsi-weight").val(1.2);
    $symbol.find(".bb-weight").val(1.2);
    $symbol.find(".cmf-weight").val(0.9);
    $symbol.find(".macd-weight").val(0);
    $symbol.find(".adx-weight").val(0);
    setChk($symbol, ".scout-indicator-rsi", true);
    setChk($symbol, ".scout-indicator-bb", true);
    setChk($symbol, ".scout-indicator-macd", false);
    $symbol.find(".indicators-preset").val("meanReversion");
  }

  function applyMomentum($symbol) {
    setChk($symbol, ".sma-enabled", false);
    setChk($symbol, ".renko-enabled", false);
    setChk($symbol, ".ema-enabled", false);
    setChk($symbol, ".macd-enabled", true);
    setChk($symbol, ".rsi-enabled", false);
    setChk($symbol, ".adx-enabled", true);
    setChk($symbol, ".atr-enabled", true);
    setChk($symbol, ".obv-enabled", false);
    setChk($symbol, ".cmf-enabled", true);
    setChk($symbol, ".bb-enabled", false);
    setChk($symbol, ".so-enabled", false);
    setChk($symbol, ".srsi-enabled", false);
    setChk($symbol, ".dmi-enabled", false);
    $symbol.find(".macd-fast").val(12);
    $symbol.find(".macd-slow").val(26);
    $symbol.find(".macd-signal").val(9);
    $symbol.find(".macd-weight").val(1.4);
    $symbol.find(".adx-weight").val(1.2);
    $symbol.find(".cmf-weight").val(0.9);
    $symbol.find(".rsi-weight").val(0);
    $symbol.find(".bb-weight").val(0);
    setChk($symbol, ".scout-indicator-rsi", false);
    setChk($symbol, ".scout-indicator-bb", false);
    setChk($symbol, ".scout-indicator-macd", true);
    $symbol.find(".indicators-preset").val("momentum");
  }

  function applyComplementary($symbol) {
    setChk($symbol, ".sma-enabled", false);
    setChk($symbol, ".renko-enabled", false);
    setChk($symbol, ".ema-enabled", false);
    setChk($symbol, ".macd-enabled", true);
    setChk($symbol, ".rsi-enabled", true);
    setChk($symbol, ".adx-enabled", true);
    setChk($symbol, ".atr-enabled", true);
    setChk($symbol, ".obv-enabled", false);
    setChk($symbol, ".cmf-enabled", true);
    setChk($symbol, ".bb-enabled", true);
    setChk($symbol, ".so-enabled", false);
    setChk($symbol, ".srsi-enabled", false);
    setChk($symbol, ".dmi-enabled", false);
    $symbol.find(".macd-weight").val(1.2);
    $symbol.find(".rsi-weight").val(1);
    $symbol.find(".adx-weight").val(1);
    $symbol.find(".bb-weight").val(1);
    $symbol.find(".cmf-weight").val(0.9);
    setChk($symbol, ".scout-indicator-rsi", true);
    setChk($symbol, ".scout-indicator-bb", true);
    setChk($symbol, ".scout-indicator-macd", false);
    $symbol.find(".indicators-preset").val("complementary");
  }

  function applyMeanReversionVolatile($symbol) {
    applyMeanReversion($symbol);
    $symbol.find(".rsi-treshold-overbought").val(75);
    $symbol.find(".rsi-treshold-oversold").val(25);
    $symbol.find(".bb-multiplier").val(2.2);
    $symbol.find(".cmf-treshold-overbought").val(0.15);
    $symbol.find(".cmf-treshold-oversold").val(-0.15);
    $symbol.find(".indicators-preset").val("meanReversionVolatile");
  }

  function applyPresetToDom($symbol, preset) {
    if (preset === "momentum") applyMomentum($symbol);
    else if (preset === "complementary") applyComplementary($symbol);
    else if (preset === "meanReversionVolatile") applyMeanReversionVolatile($symbol);
    else applyMeanReversion($symbol);
  }

  /** Round-trip fee floor hint: (fee% * 2) + 0.05 */
  function feeFloorPct(tradeFeePercentage) {
    var fee = Number(tradeFeePercentage);
    if (!Number.isFinite(fee) || fee < 0) fee = 0.1;
    return fee * 2 + 0.05;
  }

  function updateProfitFloorHint($symbol) {
    var fee = parseFloat($symbol.find(".trade-fee-percentage").val());
    var floor = feeFloorPct(fee);
    var $hint = $symbol.find(".profit-fee-floor-hint");
    if ($hint.length) {
      $hint.text(
        "Fee-lattia ≈ " +
          floor.toFixed(2) +
          "% (round-trip + 0.05). Negatiiviset / alle lattian arvot korjataan tallennuksessa."
      );
    }
  }

  global.HoobotIndicatorsPreset = {
    applyPresetToDom: applyPresetToDom,
    applyMeanReversion: applyMeanReversion,
    applyMeanReversionVolatile: applyMeanReversionVolatile,
    applyMomentum: applyMomentum,
    applyComplementary: applyComplementary,
    feeFloorPct: feeFloorPct,
    updateProfitFloorHint: updateProfitFloorHint,
  };
})(typeof window !== "undefined" ? window : globalThis);
