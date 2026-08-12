import { Router } from "express";
import { authenticate } from "../../common/middlewares/authenticate.js";
import { rateLimit } from "express-rate-limit";
import * as controller from "./auth.controller.js";

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes; intenta mas tarde",
          details: null,
        },
      }),
  });

const authRouter = Router();
authRouter.post("/register", limiter(5), controller.register);
authRouter.post("/login", limiter(10), controller.login);
authRouter.post("/verify-email", limiter(10), controller.verifyEmail);
authRouter.post("/resend-verification", limiter(3), controller.resendVerification);
authRouter.get("/google", limiter(10), controller.google);
authRouter.get("/google/callback", limiter(20), controller.googleCallback);
authRouter.post("/google/complete", limiter(5), controller.completeGoogleRegistration);
authRouter.post("/email-change/request", limiter(5), authenticate, controller.requestEmailChange);
authRouter.post("/email-change/confirm", limiter(10), controller.confirmEmailChange);
authRouter.get("/email-change/pending", limiter(20), authenticate, controller.getPendingEmailChange);
authRouter.delete("/email-change/pending", limiter(5), authenticate, controller.cancelEmailChange);
authRouter.post("/refresh", limiter(30), controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.post("/logout-all", authenticate, controller.logoutAll);
authRouter.post("/change-password", authenticate, limiter(5), controller.changePassword);
authRouter.get("/me", authenticate, controller.me);
authRouter.post("/forgot-password", limiter(5), controller.forgotPassword);
authRouter.post("/reset-password", limiter(5), controller.resetPassword);

export default authRouter;
