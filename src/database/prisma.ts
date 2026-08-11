import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as typeof globalThis & { __veloryxPrisma?: PrismaClient };
export const prisma = globalForPrisma.__veloryxPrisma ?? new PrismaClient();
if (env.NODE_ENV !== "production") globalForPrisma.__veloryxPrisma = prisma;
