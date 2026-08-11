import { Router } from "express";
import healthRoutes from "../modules/health/health.routes.js";
import parametersRoutes from "../modules/parameters/parameters.routes.js";
import authRoutes from "../modules/auth/auth.routes.js";
import usersRoutes from "../modules/users/users.routes.js";
import workspacesRoutes from "../modules/workspaces/workspaces.routes.js";

const router = Router();

router.get("/", (_request, response) => {
  response.status(200).json({
    success: true,
    message: "Servidor funcionando correctamente",
  });
});

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/workspaces", workspacesRoutes);
router.use(parametersRoutes);

export default router;
