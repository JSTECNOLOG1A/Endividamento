import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import * as store from "./store.js";
import { config } from "../../config.js";

// Proteção contra SSRF nas chamadas ao ERP.
//
// A URL base de uma integração é controlada por um OWNER do cliente. Sem esta
// guarda, apontar a URL para 127.0.0.1, 169.254.169.254 (metadata da nuvem) ou
// 10.x/192.168.x faria o servidor da Clarity varrer/alcançar a rede interna.
//
// Regras:
//  - loopback, link-local/metadata, unspecified, multicast e reservados:
//    SEMPRE bloqueados, mesmo que o host esteja na lista do cliente.
//  - rede interna da Clarity (config.erpInternalDenyCidrs): DENY absoluto,
//    nunca liberável pela lista de um tenant.
//  - faixas privadas (RFC1918) e ULA (fc00::/7): bloqueadas por padrão,
//    liberadas só se o hostname ou o IP resolvido estiver na lista do tenant.
//  - endereço público: liberado.
//
// Anti DNS rebinding: a resolução de nome e a conexão usam a MESMA resolução —
// `createPinnedLookup` resolve, classifica e devolve ao socket apenas IPs
// aprovados (o IP validado é o IP conectado). IPs literais (que não passam por
// DNS) são validados de forma síncrona antes da requisição.

function ipv4ToBigInt(addr) {
  return addr.split(".").reduce((acc, oct) => (acc << 8n) + BigInt(Number(oct)), 0n);
}

function expandIpv6(addr) {
  let ip = addr.split("%")[0];
  // Forma com IPv4 embutido no final (ex.: ::ffff:192.168.0.1).
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    const v4 = ip.slice(lastColon + 1).split(".").map((n) => Number(n));
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const doubleColon = ip.indexOf("::");
  let groups;
  if (doubleColon >= 0) {
    const left = ip.slice(0, doubleColon).split(":").filter(Boolean);
    const right = ip.slice(doubleColon + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    groups = [...left, ...Array(Math.max(missing, 0)).fill("0"), ...right];
  } else {
    groups = ip.split(":");
  }
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

function ipToBigInt(addr, version) {
  return version === 4 ? ipv4ToBigInt(addr) : expandIpv6(addr);
}

function parseCidr(str) {
  const s = String(str || "").trim();
  if (!s) return null;
  const slash = s.indexOf("/");
  const addr = slash >= 0 ? s.slice(0, slash) : s;
  const prefixStr = slash >= 0 ? s.slice(slash + 1) : undefined;
  const version = net.isIP(addr);
  if (!version) return null;
  const maxBits = version === 4 ? 32 : 128;
  let prefix;
  if (prefixStr === undefined) {
    prefix = maxBits;
  } else {
    prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return null;
  }
  return { version, base: ipToBigInt(addr, version), prefix };
}

function cidrContains(cidr, ipVersion, ipBig) {
  if (cidr.version !== ipVersion) return false;
  const bits = ipVersion === 4 ? 32n : 128n;
  const host = bits - BigInt(cidr.prefix);
  const full = (1n << bits) - 1n;
  const mask = cidr.prefix === 0 ? 0n : full ^ ((1n << host) - 1n);
  return (cidr.base & mask) === (ipBig & mask);
}

const toCidrs = (list) => list.map(parseCidr).filter(Boolean);

// Sempre bloqueados — nunca liberáveis pela lista do cliente.
const ALWAYS_BLOCK_V4 = toCidrs([
  "0.0.0.0/8", // "this host" / unspecified
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local + metadata da nuvem (169.254.169.254)
  "100.64.0.0/10", // CGNAT (RFC6598)
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // documentação (TEST-NET-1)
  "198.18.0.0/15", // benchmark
  "198.51.100.0/24", // documentação (TEST-NET-2)
  "203.0.113.0/24", // documentação (TEST-NET-3)
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reservado / futuro (inclui 255.255.255.255)
]);

const ALWAYS_BLOCK_V6 = toCidrs([
  "::/128", // unspecified
  "::1/128", // loopback
  "::/96", // IPv4-compatible (deprecado, ex.: ::127.0.0.1)
  "::ffff:0:0:0/96", // IPv4-translated (SIIT)
  "64:ff9b::/96", // NAT64 well-known
  "64:ff9b:1::/48", // NAT64 local-use
  "100::/64", // discard-only
  "2001::/32", // Teredo (embute IPv4)
  "2001:db8::/32", // documentação
  "2002::/16", // 6to4 (embute IPv4)
  "fe80::/10", // link-local
  "fec0::/10", // site-local (deprecado)
  "ff00::/8", // multicast
]);

// Faixas privadas — liberadas apenas pela lista do cliente.
const PRIVATE_V4 = toCidrs(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
const PRIVATE_V6 = toCidrs(["fc00::/7"]); // ULA

// DENY absoluto adicional (rede interna da Clarity), configurável por ambiente.
let GLOBAL_DENY_CACHE = null;
function getGlobalDeny() {
  if (GLOBAL_DENY_CACHE) return GLOBAL_DENY_CACHE;
  GLOBAL_DENY_CACHE = toCidrs(config.erpInternalDenyCidrs || []);
  return GLOBAL_DENY_CACHE;
}

// Converte uma lista de CIDRs (strings) na forma interna — usado em testes e
// por quem quiser montar um deny explícito.
export function buildDenyList(list) {
  return toCidrs(list || []);
}

// Desembrulha para IPv4 (retorna {version, value}) quando o IPv6 embute IPv4:
// mapeado (::ffff:a.b.c.d), 6to4 (2002:AABB:CCDD::) e Teredo (2001::, invertido).
function normalizeIp(ip) {
  let version = net.isIP(ip);
  if (!version) return null;
  let value = ipToBigInt(ip, version);
  if (version === 6) {
    if ((value >> 32n) === 0xffffn) {
      // ::ffff:a.b.c.d
      return { version: 4, value: value & 0xffffffffn };
    }
    if ((value >> 112n) === 0x2002n) {
      // 6to4: IPv4 nos 32 bits logo após o prefixo 2002::/16
      return { version: 4, value: (value >> 80n) & 0xffffffffn };
    }
    if ((value >> 96n) === 0x20010000n) {
      // Teredo 2001:0000::/32: IPv4 do cliente nos últimos 32 bits, invertido
      return { version: 4, value: (value & 0xffffffffn) ^ 0xffffffffn };
    }
  }
  return { version, value };
}

export function classifyIp(ip) {
  const norm = normalizeIp(ip);
  if (!norm) return "block"; // valor que não é IP não deveria chegar aqui
  const { version, value } = norm;
  const blockList = version === 4 ? ALWAYS_BLOCK_V4 : ALWAYS_BLOCK_V6;
  for (const cidr of blockList) {
    if (cidrContains(cidr, version, value)) return "block";
  }
  const privateList = version === 4 ? PRIVATE_V4 : PRIVATE_V6;
  for (const cidr of privateList) {
    if (cidrContains(cidr, version, value)) return "private";
  }
  return "public";
}

function matchesCidrList(ip, cidrs) {
  const norm = normalizeIp(ip);
  if (!norm || !cidrs?.length) return false;
  return cidrs.some((cidr) => cidrContains(cidr, norm.version, norm.value));
}

// Limites de abrangência para evitar que um OWNER libere faixas enormes
// (ex.: 0.0.0.0/0, 10.0.0.0/8) e alcance a rede interna da Clarity.
const MIN_PREFIX_V4 = 16;
const MIN_PREFIX_V6 = 48;

export function isValidHostEntry(str) {
  const entry = String(str || "").trim();
  if (!entry) return false;
  const cidr = parseCidr(entry);
  if (cidr) {
    if (cidr.prefix === 0) return false;
    if (cidr.version === 4 && cidr.prefix < MIN_PREFIX_V4) return false;
    if (cidr.version === 6 && cidr.prefix < MIN_PREFIX_V6) return false;
    return true;
  }
  // hostname (RFC 1123), sem CIDR/porta/esquema.
  if (entry.length > 253) return false;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(entry);
}

// `allowedEntries` é uma lista de hostnames e/ou CIDRs do tenant.
export function isHostAllowed(hostname, ip, allowedEntries) {
  const host = String(hostname || "").toLowerCase();
  const norm = normalizeIp(ip);
  for (const raw of allowedEntries || []) {
    const entry = String(raw || "").trim();
    if (!entry) continue;
    const cidr = parseCidr(entry);
    if (cidr) {
      if (norm && cidrContains(cidr, norm.version, norm.value)) return true;
    } else if (entry.toLowerCase() === host) {
      return true;
    }
  }
  return false;
}

function stripBrackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

async function defaultResolveHost(hostname) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function loadAllowedHostsForTenant() {
  const rows = await store.listAllowedHosts();
  return rows.map((row) => row.host);
}
const defaultLoadAllowedHosts = loadAllowedHostsForTenant;

function blockedError(hostname, ip) {
  const err = new Error(
    `O endereço do ERP (${hostname} → ${ip}) é um endereço interno reservado e não pode ser acessado pelo servidor.`
  );
  err.status = 400;
  err.code = "ERP_HOST_BLOCKED";
  return err;
}

function needsAllowlistError(hostname, ip) {
  const err = new Error(
    `O endereço do ERP (${hostname} → ${ip}) está em uma faixa de rede privada. ` +
    `Para usá-lo, cadastre este endereço na lista de endereços permitidos do cliente (Integrações → Endereços permitidos).`
  );
  err.status = 400;
  err.code = "ERP_HOST_NOT_ALLOWED";
  return err;
}

function notFoundError() {
  const err = new Error("Host do ERP não encontrado. Verifique a URL base");
  err.code = "ENOTFOUND";
  err.status = 400;
  return err;
}

// Decide se um IP resolvido pode ser conectado para este hostname.
function isAddressApproved(hostname, ip, allowedHosts, globalDeny) {
  if (matchesCidrList(ip, globalDeny)) return false; // DENY absoluto da infra
  const cls = classifyIp(ip);
  if (cls === "block") return false;
  if (cls === "private") return isHostAllowed(hostname, ip, allowedHosts);
  return true; // público não negado
}

function approvalError(hostname, ip, allowedHosts, globalDeny) {
  if (matchesCidrList(ip, globalDeny) || classifyIp(ip) === "block") {
    return blockedError(hostname, ip);
  }
  return needsAllowlistError(hostname, ip);
}

// Valida a FORMA da URL (esquema e ausência de credenciais embutidas).
export function assertUrlShape(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const err = new Error("URL inválida");
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw blockedError(parsed.hostname || rawUrl, parsed.protocol);
  }
  if (parsed.username || parsed.password) {
    const err = new Error("A URL do ERP não pode conter credenciais embutidas");
    err.status = 400;
    err.code = "ERP_HOST_BLOCKED";
    throw err;
  }
  return parsed;
}

// IPs literais não passam por DNS (o socket conecta direto), então o
// `createPinnedLookup` nunca os vê. Validamos aqui, de forma síncrona.
export function assertLiteralIpAllowed(parsed, allowedHosts, globalDeny = getGlobalDeny()) {
  const hostname = stripBrackets(parsed.hostname).toLowerCase();
  if (!net.isIP(hostname)) return; // não é literal — o lookup cuida
  if (!isAddressApproved(hostname, hostname, allowedHosts, globalDeny)) {
    throw approvalError(hostname, hostname, allowedHosts, globalDeny);
  }
}

// Lookup pinado para passar a http(s).request: resolve o nome, classifica cada
// IP e devolve ao socket APENAS endereços aprovados — o IP validado é o IP
// conectado (sem janela de rebinding entre checagem e conexão).
export function createPinnedLookup(allowedHosts, deps = {}) {
  const resolveHost = deps.resolveHost || defaultResolveHost;
  const globalDeny = deps.globalDeny || getGlobalDeny();
  return function lookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const host = stripBrackets(String(hostname)).toLowerCase();
    Promise.resolve()
      .then(async () => {
        const addrs = net.isIP(host) ? [host] : await resolveHost(host);
        if (!addrs || !addrs.length) throw notFoundError();
        const approved = addrs.filter((ip) => isAddressApproved(host, ip, allowedHosts, globalDeny));
        if (!approved.length) throw approvalError(host, addrs[0], allowedHosts, globalDeny);
        return approved;
      })
      .then((approved) => {
        if (options && options.all) {
          callback(null, approved.map((address) => ({ address, family: net.isIP(address) })));
        } else {
          callback(null, approved[0], net.isIP(approved[0]));
        }
      })
      .catch((err) => callback(err));
  };
}

// Verificação completa (forma + resolução + aprovação). Mantida para uso
// pontual e testes; a garantia anti-rebinding em runtime vem do pinned lookup.
export async function assertUrlAllowed(rawUrl, deps = {}) {
  const resolveHost = deps.resolveHost || defaultResolveHost;
  const globalDeny = deps.globalDeny || getGlobalDeny();
  const allowedHosts = deps.allowedHosts
    || (deps.loadAllowedHosts ? await deps.loadAllowedHosts() : await defaultLoadAllowedHosts());

  const parsed = assertUrlShape(rawUrl);
  const hostname = stripBrackets(parsed.hostname).toLowerCase();
  const ips = net.isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!ips || !ips.length) throw notFoundError();

  for (const ip of ips) {
    if (!isAddressApproved(hostname, ip, allowedHosts, globalDeny)) {
      throw approvalError(hostname, ip, allowedHosts, globalDeny);
    }
  }
  return { hostname, ips };
}
