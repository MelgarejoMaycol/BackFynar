import { Router } from "express";
import * as controller from "./notifications.controller.js";

const router = Router({ mergeParams: true });

router.get("/", controller.list);
router.get("/summary", controller.summary);
router.post("/refresh", controller.refresh);
router.post("/read-all", controller.markAllRead);
router.post("/:notificationId/read", controller.markRead);
router.post("/:notificationId/dismiss", controller.dismiss);

export default router;
