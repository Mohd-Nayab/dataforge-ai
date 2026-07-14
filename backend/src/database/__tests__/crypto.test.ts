import { describe, expect, it } from "vitest";

import { decrypt, encrypt, isEncrypted } from "../core/crypto.js";

describe("credential crypto (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const secret = "super$ecret-p@ss word";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(decrypt(enc)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encrypt("value");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => decrypt("not-a-valid-payload")).toThrow();
    expect(isEncrypted("plain")).toBe(false);
  });
});
