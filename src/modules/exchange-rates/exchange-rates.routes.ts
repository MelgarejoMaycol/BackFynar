import { Router } from "express";
import {
  convertCurrency,
  getCurrencies,
  getHistory,
  getRates,
} from "./exchange-rates.controller.js";

const router = Router();

router.get("/currencies", getCurrencies);
router.get("/rates", getRates);
router.get("/convert", convertCurrency);
router.get("/history", getHistory);

export default router;
