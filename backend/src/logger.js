import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.env === "production" ? "info" : "debug"),
  base: { service: "endividamento-api", version: "1.0.0" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.query.token",
      "*.password",
      "*.password_hash",
      "*.reset_url",
      "*.invite_url",
      "*.token",
      "*.credential",
    ],
    remove: true,
  },
});
