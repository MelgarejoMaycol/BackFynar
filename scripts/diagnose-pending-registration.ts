import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Uso: tsx scripts/diagnose-pending-registration.ts correo");
const prisma = new PrismaClient();
try {
  const [user, pending] = await Promise.all([
    prisma.user.findUnique({
      where: { email },
      select: { id: true, isEmailVerified: true, createdAt: true },
    }),
    prisma.pendingRegistration.findUnique({
      where: { email },
      select: {
        id: true,
        emailSentAt: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  console.log(JSON.stringify({ user, pending }));
} finally {
  await prisma.$disconnect();
}
