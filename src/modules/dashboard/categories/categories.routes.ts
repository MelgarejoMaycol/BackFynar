import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./categories.controller.js";

const router = Router({ mergeParams: true });
router.get("/", requirePermission("categories.read"), controller.list);
router.get("/:categoryId", requirePermission("categories.read"), controller.get);
router.post("/", requirePermission("categories.write"), controller.create);
router.patch("/:categoryId", requirePermission("categories.write"), controller.update);
router.delete("/:categoryId", requirePermission("categories.write"), controller.archive);
router.post("/:categoryId/restore", requirePermission("categories.write"), controller.restore);
export default router;
