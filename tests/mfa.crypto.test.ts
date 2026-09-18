import { describe, expect, it } from "vitest";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "../src/modules/auth/mfa.crypto.js";

describe("MFA crypto", () => {
  it("verifica un vector TOTP SHA1 conocido", () => {
    expect(
      verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000),
    ).toBe(true);
    expect(
      verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "000000", 59_000),
    ).toBe(false);
  });

  it("cifra y descifra el secreto TOTP", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("genera códigos de recuperación únicos y normaliza el hash", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0]!)).toBe(
      hashRecoveryCode(codes[0]!.replace("-", "").toLowerCase()),
    );
  });
});
