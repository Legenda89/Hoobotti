import {
  getStopLossCooldownStatus,
  registerStopLossClose,
  resetConsecutiveLossGuard,
  shouldBlockStopLossCooldownEntry,
} from "./consecutiveLossGuard";
import type { SymbolOptions } from "../Utilities/Args";

const sym = (over: Partial<SymbolOptions> = {}): SymbolOptions =>
  ({
    name: "BTC/EUR",
    blockConsecutiveLoss: { enabled: true, skipEntries: 1, cooldownMinutes: 0, cooldownAfterStopLossMinutes: 20 },
    ...over,
  }) as SymbolOptions;

describe("stopLoss cooldown", () => {
  beforeEach(() => resetConsecutiveLossGuard("BTCEUR"));

  it("blocks entry after STOP_LOSS close", () => {
    registerStopLossClose("BTCEUR", sym());
    expect(getStopLossCooldownStatus("BTCEUR").active).toBe(true);
    expect(shouldBlockStopLossCooldownEntry("BTCEUR", sym(), "BUY", "SKIP")).toBe(true);
    expect(shouldBlockStopLossCooldownEntry("BTCEUR", sym(), "BUY", "STOP_LOSS")).toBe(false);
    expect(shouldBlockStopLossCooldownEntry("BTCEUR", sym(), "BUY", "TAKE_PROFIT", false)).toBe(true);
    expect(shouldBlockStopLossCooldownEntry("BTCEUR", sym(), "SELL", "TAKE_PROFIT", true)).toBe(false);
  });

  it("does not block when cooldownAfterStopLossMinutes is 0", () => {
    registerStopLossClose(
      "BTCEUR",
      sym({ blockConsecutiveLoss: { enabled: true, cooldownAfterStopLossMinutes: 0 } })
    );
    expect(shouldBlockStopLossCooldownEntry("BTCEUR", sym(), "BUY", "SKIP")).toBe(false);
  });
});
