import { withRetry } from "./Retry";

describe("withRetry", () => {
  it("returns result when fn succeeds", async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  it("retries and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail");
      return "ok";
    }, { maxRetries: 3, delayMs: 1 });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("throws after max retries", async () => {
    await expect(
      withRetry(async () => {
        throw new Error("always fail");
      }, { maxRetries: 2, delayMs: 1 })
    ).rejects.toThrow("always fail");
  });
});
