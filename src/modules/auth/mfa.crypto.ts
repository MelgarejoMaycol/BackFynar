import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../../config/env.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

const normalizeBase32 = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z2-7]/g, "");

export const encodeBase32 = (input: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

const decodeBase32 = (input: string): Buffer => {
  const normalized = normalizeBase32(input);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("TOTP_SECRET_INVALID");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const encryptionKey = (): Buffer =>
  createHash("sha256")
    .update(env.MFA_ENCRYPTION_KEY ?? `${env.JWT_ACCESS_SECRET}:fynar:mfa:v1`)
    .digest();

export const encryptMfaSecret = (secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
};

export const decryptMfaSecret = (payload: string): string => {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("MFA_SECRET_PAYLOAD_INVALID");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const hotp = (secret: string, counter: number): string => {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
};

export const verifyTotp = (secret: string, code: string, now = Date.now()): boolean => {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now / 1000 / PERIOD_SECONDS);
  const received = Buffer.from(normalized);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(hotp(secret, counter + offset));
    if (expected.length === received.length && timingSafeEqual(expected, received)) return true;
  }
  return false;
};

export const generateTotpSecret = (): string => encodeBase32(randomBytes(20));

export const buildOtpAuthUri = (email: string, secret: string): string => {
  const issuer = env.MFA_ISSUER;
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
};

const normalizeRecoveryCode = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z2-7]/g, "");

export const generateRecoveryCodes = (count = 10): string[] =>
  Array.from({ length: count }, () => {
    const raw = encodeBase32(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

export const hashRecoveryCode = (code: string): string =>
  createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

export const looksLikeRecoveryCode = (code: string): boolean =>
  normalizeRecoveryCode(code).length === 10;
