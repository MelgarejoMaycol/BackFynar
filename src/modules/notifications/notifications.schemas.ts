import { notification_type } from "@prisma/client";
import { z } from "zod";

export const notificationIdSchema = z.string().uuid();

export const listNotificationsSchema = z
  .object({
    status: z.enum(["ALL", "UNREAD", "READ"]).default("ALL"),
    type: z.nativeEnum(notification_type).optional(),
    includeDismissed: z.enum(["true", "false"]).default("false"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;
