import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getParameters, getRoles, getSystemCategories } from "./parameters.service.js";
const router = Router();
type ParameterOperation = () => unknown | Promise<unknown>;
const send =
  (operation: ParameterOperation): RequestHandler =>
  async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      response.json({ success: true, data: await operation() });
    } catch (error: unknown) {
      next(error);
    }
  };
router.get("/parameters", send(getParameters));
router.get("/roles", send(getRoles)); // Público temporalmente; proteger al incorporar auth.
router.get("/categories/system", send(getSystemCategories));
export default router;
