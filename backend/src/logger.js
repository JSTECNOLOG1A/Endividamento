import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.env === "production" ? "info" : "debug"),
  base: { service: "fincalc-api", version: "1.0.0" },
});
