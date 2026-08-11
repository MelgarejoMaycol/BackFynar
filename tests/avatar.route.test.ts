import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/database/prisma.js", () => ({ prisma: {} }));
import app from "../src/app.js";

describe("ruta de avatar", () => {
  it("rechaza usuarios no autenticados antes de procesar el archivo", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/avatar")
      .attach("avatar", Buffer.from("image"), {
        filename: "avatar.jpg",
        contentType: "image/jpeg",
      });
    expect(response.status).toBe(401);
  });
});
