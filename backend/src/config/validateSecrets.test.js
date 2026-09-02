import { validateProductionSecrets } from "./validateSecrets.js";

function fail(message) {
  throw new Error(message);
}

function expectThrow(env) {
  try {
    validateProductionSecrets(env);
    return false;
  } catch (error) {
    return error.code === "INSECURE_SECRETS";
  }
}

if (validateProductionSecrets({ NODE_ENV: "development" }).ok !== true) {
  fail("development deve passar sem secrets");
}

if (!expectThrow({ NODE_ENV: "production" })) {
  fail("production sem secrets deve falhar");
}

if (!expectThrow({
  NODE_ENV: "production",
  JWT_SECRET: "dev-only-change-me-min-32-characters!!",
  CREDENTIALS_ENCRYPTION_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ADMIN_PASSWORD: "Endividamento!Local1",
})) {
  fail("production com defaults conhecidos deve falhar");
}

if (!expectThrow({
  NODE_ENV: "production",
  JWT_SECRET: "change-this-to-a-long-random-secret-32chars",
  CREDENTIALS_ENCRYPTION_KEY: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ADMIN_PASSWORD: "UmaSenhaForte12",
})) {
  fail("JWT com change-this deve falhar");
}

const ok = validateProductionSecrets({
  NODE_ENV: "production",
  JWT_SECRET: "k7vN2pQ9xL4mR8tW1cF6hJ3bS5dA0eU2",
  CREDENTIALS_ENCRYPTION_KEY: "z8nM1qP6wK3jT9rY2vG5iH0aD4fB7cE3",
  ADMIN_PASSWORD: "SenhaMasterForte!2026",
});
if (!ok.ok) fail("secrets fortes em production devem passar");

console.log("validateSecrets ok");
