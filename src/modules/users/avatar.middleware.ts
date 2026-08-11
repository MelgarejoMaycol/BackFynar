import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ValidationError } from "../../common/errors/app-error.js";
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from "./avatar.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!AVATAR_MIME_TYPES.has(file.mimetype))
      return callback(new ValidationError("Selecciona una imagen JPG, PNG o WEBP."));
    callback(null, true);
  },
}).single("avatar");

export function receiveAvatar(request: Request, response: Response, next: NextFunction): void {
  upload(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE")
      return next(new ValidationError("La imagen no puede superar los 5 MB."));
    if (error) return next(error);
    next();
  });
}
