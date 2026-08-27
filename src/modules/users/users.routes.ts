import { Router } from "express";
import { authenticate } from "../../common/middlewares/authenticate.js";
import * as controller from "./users.controller.js";
import { receiveAvatar } from "./avatar.middleware.js";

const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.get("/me", controller.getProfile);
usersRouter.patch("/me", controller.updateProfile);
usersRouter.patch("/me/avatar", receiveAvatar, controller.updateAvatar);
usersRouter.get("/me/preferences", controller.getPreferences);
usersRouter.patch("/me/preferences", controller.updatePreferences);
usersRouter.delete("/me", controller.deleteAccount);
export default usersRouter;
