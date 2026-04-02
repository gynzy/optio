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

    it("uses per-registration secret when available and rejects global secret", () => {
      const registrationSecret = "per-registration-secret";
      const globalSecret = "global-fallback-secret";
      const payload = '{"oauthClientId":"client-123","agentSession":{"id":"sess-1"}}';

      const sigWithRegistration = crypto
        .createHmac("sha256", registrationSecret)
        .update(payload)
        .digest("hex");

      // Valid with the registration secret
      expect(verifyLinearSignature(payload, sigWithRegistration, registrationSecret)).toBe(true);
      // Invalid with the global fallback secret
      expect(verifyLinearSignature(payload, sigWithRegistration, globalSecret)).toBe(false);
    });

    it("falls back to global secret when no registration matches", () => {
      const globalSecret = "global-fallback-secret";
      const payload = '{"agentSession":{"id":"sess-2"}}';

      const sigWithGlobal = crypto.createHmac("sha256", globalSecret).update(payload).digest("hex");

      expect(verifyLinearSignature(payload, sigWithGlobal, globalSecret)).toBe(true);
    });
  });
});
