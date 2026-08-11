import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableTransactionError,
  withTransactionRetry,
} from "../src/database/transaction-retry.js";

const prismaError = (code: string, databaseCode?: string) =>
  new Prisma.PrismaClientKnownRequestError("transaction error", {
    code,
    clientVersion: "6.19.0",
    ...(databaseCode ? { meta: { code: databaseCode } } : {}),
  });

describe("transaction retry", () => {
  it.each([
    ["P2034", undefined, true],
    ["P2010", "40001", true],
    ["P2010", "40P01", true],
    ["P2010", "23505", false],
  ])("clasifica %s/%s como reintentable=%s", (code, databaseCode, expected) => {
    expect(isRetryableTransactionError(prismaError(code, databaseCode))).toBe(expected);
  });

  it("rechaza como reintentable un error que no es conocido de Prisma", () => {
    expect(isRetryableTransactionError(new Error("internal"))).toBe(false);
  });

  it("devuelve el éxito del segundo intento", async () => {
    const transient = prismaError("P2034");
    const operation = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce("ok");
    await expect(withTransactionRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("limita a tres intentos y propaga el último error", async () => {
    const errors = [
      prismaError("P2034"),
      prismaError("P2010", "40001"),
      prismaError("P2010", "40P01"),
    ];
    const operation = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2]);
    await expect(withTransactionRetry(operation)).rejects.toBe(errors[2]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("no repite errores no transitorios", async () => {
    const error = prismaError("P2010", "23505");
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withTransactionRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });
});
