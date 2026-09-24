import { isTransientNetworkError } from "./networkErrors";

describe("isTransientNetworkError", () => {
  it("detects Discord ws handshake timeout", () => {
    expect(isTransientNetworkError(new Error("Opening handshake has timed out"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isTransientNetworkError(new Error("Invalid token"))).toBe(false);
  });
});
