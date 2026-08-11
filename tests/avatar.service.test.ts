import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeAvatar } from "../src/modules/users/avatar.service.js";

describe("optimización de avatar", () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    it(`acepta ${format.toUpperCase()}, limita dimensiones y produce WebP`, async () => {
      const source = await sharp({
        create: { width: 900, height: 600, channels: 3, background: "#17675c" },
      })
        [format]()
        .toBuffer();
      const result = await optimizeAvatar(source);
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBeLessThanOrEqual(512);
      expect(metadata.height).toBeLessThanOrEqual(512);
    });
  }

  it("rechaza contenido que no es una imagen real", async () => {
    await expect(optimizeAvatar(Buffer.from("not-an-image"))).rejects.toThrow();
  });
});
