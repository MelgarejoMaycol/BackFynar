import { describe, expect, it, vi } from "vitest";
import { UsersService } from "../src/modules/users/users.service.js";
import type { UsersRepository } from "../src/modules/users/users.repository.js";

const profile = {
  id: "user-id",
  email: "ana@example.com",
  firstName: "Ana",
  lastName: null,
  phone: null,
  avatarUrl: null,
  isEmailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("UsersService avatar", () => {
  it("sube primero y solo después actualiza avatarUrl", async () => {
    const update = vi.fn().mockResolvedValue({
      ...profile,
      avatarUrl: "https://res.cloudinary.com/demo/avatar.webp",
    });
    const repository = {
      findActiveProfile: vi.fn().mockResolvedValue(profile),
      updateActiveProfile: update,
    } as unknown as UsersRepository;
    const optimize = vi.fn().mockResolvedValue(Buffer.from("optimized"));
    const upload = vi.fn().mockResolvedValue("https://res.cloudinary.com/demo/avatar.webp");
    const service = new UsersService(repository, optimize, upload);
    const result = await service.updateAvatar("user-id", Buffer.from("original"));
    expect(optimize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith("user-id", Buffer.from("optimized"));
    expect(update).toHaveBeenCalledWith("user-id", {
      avatarUrl: "https://res.cloudinary.com/demo/avatar.webp",
    });
    expect(result.avatarUrl).toContain("cloudinary.com");
  });

  it("si Cloudinary falla no actualiza avatarUrl", async () => {
    const update = vi.fn();
    const repository = {
      findActiveProfile: vi.fn().mockResolvedValue(profile),
      updateActiveProfile: update,
    } as unknown as UsersRepository;
    const service = new UsersService(
      repository,
      vi.fn().mockResolvedValue(Buffer.from("optimized")),
      vi.fn().mockRejectedValue(new Error("Cloudinary unavailable")),
    );
    await expect(service.updateAvatar("user-id", Buffer.from("original"))).rejects.toThrow(
      "Cloudinary unavailable",
    );
    expect(update).not.toHaveBeenCalled();
  });
});
