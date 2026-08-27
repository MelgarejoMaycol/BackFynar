import { prisma } from "../src/database/prisma.js";
import { passwordService } from "../src/modules/auth/auth-password.service.js";
import { requireIsolatedTestDatabase } from "./test-database-guard.js";

requireIsolatedTestDatabase(process.env);
const email = "e2e-fynar@example.com";
const password = "E2E secure password 1!";
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash: await passwordService.hash(password), isEmailVerified: true, isActive: true },
  });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: existing.id } });
  await prisma.userPreference.updateMany({
    where: { userId: existing.id },
    data: { defaultWorkspaceId: workspace.id, financialCycleStartDay: null },
  });
  console.log(JSON.stringify({ email, workspaceId: workspace.id }));
  await prisma.$disconnect();
  process.exit(0);
}
const owner = await prisma.role.findUniqueOrThrow({ where: { code: "OWNER" } });
const now = new Date();
const user = await prisma.user.create({
  data: {
    email,
    passwordHash: await passwordService.hash(password),
    firstName: "E2E",
    lastName: "Fynar",
    isEmailVerified: true,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    legalVersion: "e2e",
    authIdentities: {
      create: { provider: "LOCAL", providerSubject: email, providerEmail: email },
    },
  },
});
const workspace = await prisma.workspace.create({
  data: { name: "Certificación E2E", type: "PERSONAL", ownerUserId: user.id },
});
await prisma.workspaceMember.create({
  data: { workspaceId: workspace.id, userId: user.id, roleId: owner.id, status: "ACTIVE", joinedAt: now },
});
await prisma.userPreference.create({
  data: { userId: user.id, defaultWorkspaceId: workspace.id, timezone: "America/Bogota", theme: "LIGHT" },
});
console.log(JSON.stringify({ email, workspaceId: workspace.id }));
await prisma.$disconnect();
