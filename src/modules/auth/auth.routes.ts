import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../common/middlewares/authenticate.js";
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
authRouter.post("/refresh", limiter(30), controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.post("/logout-all", authenticate, controller.logoutAll);
authRouter.post("/change-password", authenticate, limiter(5), controller.changePassword);
authRouter.get("/me", authenticate, controller.me);
authRouter.post("/forgot-password", limiter(5), controller.forgotPassword);
authRouter.post("/reset-password", limiter(5), controller.resetPassword);

export default authRouter;
