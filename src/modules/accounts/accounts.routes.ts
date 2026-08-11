import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./accounts.controller.js";

const router = Router({ mergeParams: true });
router.post("/", requirePermission("accounts.write"), controller.create);
router.get("/", requirePermission("accounts.read"), controller.list);
router.get("/:accountId", requirePermission("accounts.read"), controller.get);
router.patch("/:accountId", requirePermission("accounts.write"), controller.update);
router.patch("/:accountId/favorite", requirePermission("accounts.write"), controller.favorite);
router.post("/:accountId/archive", requirePermission("accounts.write"), controller.archive);
router.post("/:accountId/restore", requirePermission("accounts.write"), controller.restore);
router.delete("/:accountId", requirePermission("accounts.write"), controller.remove);
export default router;
