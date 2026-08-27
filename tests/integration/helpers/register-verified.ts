import request from "supertest";
import { vi } from "vitest";
import app from "../../../src/app.js";
import { prisma } from "../../../src/database/prisma.js";
import { emailService } from "../../../src/modules/auth/email.service.js";

export const registerVerified = async (input: {
  email: string;
  password: string;
  firstName: string;
}) => {
  let token = "";
  const emailSpy = vi.spyOn(emailService, "sendVerification").mockImplementation(async (message) => {
    if (message.recipient === input.email)
      token = new URL(message.verificationUrl).searchParams.get("token") ?? "";
  });
  try {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...input, acceptedTerms: true });
    if (registered.status !== 201 || !token)
      throw new Error(`No se pudo iniciar el registro verificado (${registered.status})`);
    const verified = await request(app).post("/api/v1/auth/verify-email").send({ token });
    if (verified.status !== 204)
      throw new Error(`No se pudo verificar el registro (${verified.status})`);
  } finally {
    emailSpy.mockRestore();
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: user.id } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: input.email, password: input.password });
  if (login.status !== 200) throw new Error(`No se pudo iniciar sesión (${login.status})`);
  return { user, workspace, login };
};
