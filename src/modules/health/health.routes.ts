import { Router } from "express";
import { getHealth, getLiveness, getReadiness } from "./health.service.js";
const router = Router();
router.get("/", async (_request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getHealth() });
  } catch (error) {
    next(error);
  }
});
router.get("/live", (_request, response) => response.json({ success: true, data: getLiveness() }));
router.get("/ready", async (_request, response, next) => {
  try {
    const data = await getReadiness();
    response.status(data.ready ? 200 : 503).json({ success: data.ready, data });
  } catch (error) {
    next(error);
  }
});
export default router;
