import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload } from "./webhooks";

describe("signPayload", () => {
  it("produces an sha256= prefixed hex HMAC matching a manual computation", () => {
    const secret = "test-secret";
    const body = JSON.stringify({ hello: "world" });
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(signPayload(secret, body)).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    const body = JSON.stringify({ a: 1 });
    expect(signPayload("secret-a", body)).not.toBe(signPayload("secret-b", body));
  });

  it("produces different signatures for different bodies", () => {
    const secret = "same-secret";
    expect(signPayload(secret, "a")).not.toBe(signPayload(secret, "b"));
  });
});
