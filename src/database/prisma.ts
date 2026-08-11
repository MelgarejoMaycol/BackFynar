import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as typeof globalThis & { __fynarPrisma?: PrismaClient };
export const prisma = globalForPrisma.__fynarPrisma ?? new PrismaClient();
if (env.NODE_ENV !== "production") globalForPrisma.__fynarPrisma = prisma;
