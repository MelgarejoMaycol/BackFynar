import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import indexRoutes from "./routes/index.routes.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./common/middlewares/error-handler.js";
import { AppError } from "./common/errors/app-error.js";
import { requestContext } from "./common/middlewares/request-context.js";
import { httpLogger } from "./common/middlewares/http-logger.js";

const app = express();
if (env.TRUST_PROXY !== "false") {
  app.set("trust proxy", /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
}
app.use(requestContext);
app.use(httpLogger);

/**
 * Seguridad básica mediante encabezados HTTP.
 */
app.use(helmet());
app.use(cookieParser());

/**
 * Permite únicamente los orígenes configurados y clientes sin cabecera Origin.
 */
const origins = new Set(
  env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.has(origin)) return callback(null, true);
      return callback(
        new AppError("Origen no autorizado", {
          status: 403,
          code: "CORS_ORIGIN_DENIED",
          publicMessage: "Origen no autorizado",
        }),
      );
    },
  }),
);

/**
 * Permite recibir cuerpos JSON.
 */
app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));

/**
 * Permite recibir formularios tradicionales.
 */
app.use(
  express.urlencoded({
    extended: true,
    limit: env.REQUEST_BODY_LIMIT,
  }),
);

/**
 * Punto de entrada público para comprobaciones de plataforma y visitantes.
 */
app.get("/", (_request, response) => {
  response.status(200).json({
    success: true,
    data: {
      service: "Fynar API",
      status: "ok",
      apiVersion: env.API_VERSION,
      apiBasePath: env.API_PREFIX,
      healthPath: `${env.API_PREFIX}/health/live`,
    },
  });
});

/**
 * Rutas principales de la API.
 */
app.use(env.API_PREFIX, indexRoutes);

/**
 * Ruta para solicitudes que no existen.
 */
app.use(notFoundHandler);

/**
 * Manejador general de errores.
 */
app.use(errorHandler);

export default app;
