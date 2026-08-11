import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/common/errors/app-error.js";
import type { CategoriesRepository } from "../src/modules/categories/categories.repository.js";
import { CategoriesService } from "../src/modules/categories/categories.service.js";

describe("servicio defensivo de categorías", () => {
  it("traduce P2002 durante restauración a un 409 público y sanitizado", async () => {
    const archived = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      parentId: null,
      name: "Reservada",
      type: "EXPENSE",
      icon: null,
      color: null,
      isSystem: false,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    } as const;
    const repository = {
      transaction: async <T>(operation: (tx: never) => Promise<T>) => operation({} as never),
      findVisible: async () => archived,
      update: async () => {
        throw new Prisma.PrismaClientKnownRequestError("unique conflict", {
          code: "P2002",
          clientVersion: "6.19.0",
        });
      },
    } as unknown as CategoriesRepository;
    const service = new CategoriesService(repository);

    const failure = service.restore(archived.workspaceId, archived.id);
    await expect(failure).rejects.toBeInstanceOf(ConflictError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      publicMessage: expect.not.stringContaining("P2002"),
    });
  });
});
