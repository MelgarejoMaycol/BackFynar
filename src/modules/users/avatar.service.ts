import sharp from "sharp";
import { cloudinaryClient, requireCloudinaryConfig } from "../../config/cloudinary.js";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function optimizeAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(512, 512, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
}

export async function uploadAvatar(userId: string, buffer: Buffer): Promise<string> {
  requireCloudinaryConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinaryClient.uploader.upload_stream(
      {
        public_id: `fynar/avatars/${userId}/avatar`,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
        format: "webp",
      },
      (error, result) => {
        if (error || !result?.secure_url) reject(error ?? new Error("Cloudinary no devolvió URL"));
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}
