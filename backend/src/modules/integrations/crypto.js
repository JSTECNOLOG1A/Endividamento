import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../../config.js";

const ALGO = "aes-256-gcm";
const GCM_OPTIONS = { authTagLength: 16 };

function getKey() {
  return crypto.createHash("sha256").update(config.credentialsEncryptionKey).digest();
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv, GCM_OPTIONS);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload) {
  const [ivHex, tagHex, dataHex] = String(payload || "").split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Credencial criptografada inválida");
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"), GCM_OPTIONS);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// --- Export protegido por senha ---------------------------------------------
// As credenciais exportadas NUNCA saem em texto puro: são re-cifradas com uma
// chave derivada da passphrase informada na requisição (scrypt → AES-256-GCM).
// O envelope carrega o salt, então o import só precisa da mesma passphrase.
//
// A derivação scrypt é CARA (~dezenas de ms) de propósito; por isso o export/
// import usa a versão ASSÍNCRONA (crypto.scrypt), que não trava o event loop.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };
const PASSPHRASE_PREFIX = "scrypt";
const scryptAsync = promisify(crypto.scrypt);

function deriveKeySync(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
}

function deriveKey(passphrase, salt) {
  return scryptAsync(String(passphrase), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
}

function sealWithKey(plain, key) {
  const salt = key.salt;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key.bytes, iv, GCM_OPTIONS);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PASSPHRASE_PREFIX,
    salt.toString("hex"),
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function openWithBytes(payload, keyBytes) {
  const parts = String(payload || "").split(":");
  if (parts.length !== 5 || parts[0] !== PASSPHRASE_PREFIX) {
    throw new Error("Credencial exportada inválida");
  }
  const [, , ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, keyBytes, Buffer.from(ivHex, "hex"), GCM_OPTIONS);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function saltOf(payload) {
  const parts = String(payload || "").split(":");
  if (parts.length !== 5 || parts[0] !== PASSPHRASE_PREFIX) {
    throw new Error("Credencial exportada inválida");
  }
  return Buffer.from(parts[1], "hex");
}

// Versões síncronas (uso pontual/testes).
export function encryptWithPassphrase(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  return sealWithKey(plain, { bytes: deriveKeySync(passphrase, salt), salt });
}

export function decryptWithPassphrase(payload, passphrase) {
  return openWithBytes(payload, deriveKeySync(passphrase, saltOf(payload)));
}

// Versões assíncronas — usadas pelo export/import para não travar o event loop.
export async function encryptWithPassphraseAsync(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const bytes = await deriveKey(passphrase, salt);
  return sealWithKey(plain, { bytes, salt });
}

export async function decryptWithPassphraseAsync(payload, passphrase) {
  const bytes = await deriveKey(passphrase, saltOf(payload));
  return openWithBytes(payload, bytes);
}

export function generateCode(prefix) {
  const year = new Date().getFullYear();
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${year}-${hex}`;
}
