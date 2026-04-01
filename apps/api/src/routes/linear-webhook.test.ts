import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyLinearSignature } from "./linear-webhook.js";

describe("linear-webhook", () => {
  describe("verifyLinearSignature", () => {
    const secret = "test-webhook-secret";
    const body = '{"test":"payload"}';

    it("returns true for a valid HMAC signature", () => {
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      expect(verifyLinearSignature(body, expected, secret)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      expect(verifyLinearSignature(body, "invalid-hex-string-of-same-length-00", secret)).toBe(
        false,
      );
    });

    it("returns false for a tampered body", () => {
      const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
      expect(verifyLinearSignature('{"tampered":true}', sig, secret)).toBe(false);
    });

    it("returns false for empty signature", () => {
      expect(verifyLinearSignature(body, "", secret)).toBe(false);
    });
  });
});
