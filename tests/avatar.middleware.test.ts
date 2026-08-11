import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { receiveAvatar } from "../src/modules/users/avatar.middleware.js";
import { errorHandler } from "../src/common/middlewares/error-handler.js";

const app = express();
app.patch("/avatar", receiveAvatar, (req, res) =>
  res.status(200).json({ type: req.file?.mimetype, size: req.file?.size }),
);
app.use(errorHandler);

describe("middleware de avatar", () => {
  for (const [extension, mime] of [
    ["jpg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const) {
    it(`acepta ${extension.toUpperCase()}`, async () => {
      const response = await request(app)
        .patch("/avatar")
        .attach("avatar", Buffer.from("image-content"), {
          filename: `avatar.${extension}`,
          contentType: mime,
        });
      expect(response.status).toBe(200);
      expect(response.body.type).toBe(mime);
    });
  }

  it("rechaza MIME inválido", async () => {
    const response = await request(app).patch("/avatar").attach("avatar", Buffer.from("pdf"), {
      filename: "archivo.pdf",
      contentType: "application/pdf",
    });
    expect(response.status).toBe(400);
  });

  it("rechaza archivos mayores de 5 MB", async () => {
    const response = await request(app)
      .patch("/avatar")
      .attach("avatar", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "avatar.jpg",
        contentType: "image/jpeg",
      });
    expect(response.status).toBe(400);
  });
});
