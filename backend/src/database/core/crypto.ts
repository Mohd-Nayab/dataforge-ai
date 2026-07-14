/**
 * Authenticated AES-256-GCM encryption for connection credentials at rest.
 *
 * A 256-bit key is derived from APP_SECRET (or JWT_SECRET as a fallback) via
 * scrypt. Each ciphertext is self-describing: `v1:<iv>:<tag>:<data>` (base64),
 * so we can rotate algorithms later without ambiguity.
 *
 * Passwords are NEVER written to disk in plain text.
 */
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_SALT = "dataforge.credential.v1";

function resolveSecret(): string {
  const secret = process.env.APP_SECRET ?? process.env.JWT_SECRET;
  if (!secret || secret === "change-me-in-production") {
    // Non-fatal: we still encrypt, but warn loudly so prod gets a real secret.
    // eslint-disable-next-line no-console
    console.warn(
      "⚠️  APP_SECRET/JWT_SECRET not set to a strong value — credential encryption is using a weak key."
    );
  }
  return secret ?? "insecure-development-secret";
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto.scryptSync(resolveSecret(), KEY_SALT, 32);
  }
  return cachedKey;
}

/** Encrypt a UTF-8 string. Returns `v1:iv:tag:data` (all base64). */
export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** Decrypt a value produced by {@link encrypt}. Throws on tamper/format error. */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed or unsupported ciphertext.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** True if a string looks like our ciphertext (used during migrations). */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}
