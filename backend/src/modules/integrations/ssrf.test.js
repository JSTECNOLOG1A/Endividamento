import http from "node:http";
import {
  classifyIp,
  isHostAllowed,
  isValidHostEntry,
  assertUrlAllowed,
  createPinnedLookup,
  buildDenyList,
} from "./ssrfGuard.js";
import { safeFetch } from "./erpConnection.js";
import { encryptWithPassphrase, decryptWithPassphrase } from "./crypto.js";

// Guarda anti-SSRF do módulo de integrações (C2 + achados 1-4 da revisão) e
// export cifrado por senha (A3). Tudo sem banco: dependências injetadas.

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

async function expectThrow(fn, code, message) {
  try {
    await fn();
    failures.push(`${message}: não lançou (esperava ${code})`);
  } catch (error) {
    if (code && error?.code !== code) {
      failures.push(`${message}: lançou code=${error?.code}, esperava ${code}`);
    }
  }
}

// Promete o resultado de um lookup estilo net.connect (callback(err,addr,fam)).
function runLookup(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

// --- classifyIp -------------------------------------------------------------
function classifyTests() {
  const block = [
    "127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "169.254.0.1",
    "255.255.255.255", "224.0.0.1", "100.64.0.1", "198.18.0.1", "192.0.2.5",
    "::1", "::", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", // IPv4 mapeado loopback
    "::127.0.0.1", // IPv4-compatible loopback (achado 2)
    "::ffff:0:7f00:1", // SIIT embutindo 127.0.0.1 (achado 2)
    "2002:7f00:1::", // 6to4 embutindo 127.0.0.1 (achado 2)
    "2002:a9fe:a9fe::", // 6to4 embutindo 169.254.169.254 (achado 2)
    "2001::80ff:fffe", // Teredo embutindo 127.0.0.1 (achado 2)
    "64:ff9b:1::1", // NAT64 local (achado 2)
  ];
  for (const ip of block) check(classifyIp(ip) === "block", `classifyIp(${ip}) deveria ser block, veio ${classifyIp(ip)}`);

  const priv = ["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.1", "192.168.0.1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1"];
  for (const ip of priv) check(classifyIp(ip) === "private", `classifyIp(${ip}) deveria ser private, veio ${classifyIp(ip)}`);

  const pub = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "11.0.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:0808:0808::"];
  for (const ip of pub) check(classifyIp(ip) === "public", `classifyIp(${ip}) deveria ser public, veio ${classifyIp(ip)}`);
}

// --- isHostAllowed ----------------------------------------------------------
function allowTests() {
  check(isHostAllowed("erp.cliente.com.br", "10.0.0.5", ["erp.cliente.com.br"]) === true, "match por hostname");
  check(isHostAllowed("ERP.Cliente.com.BR", "10.0.0.5", ["erp.cliente.com.br"]) === true, "match por hostname case-insensitive");
  check(isHostAllowed("x", "10.0.0.5", ["10.0.0.0/24"]) === true, "match por CIDR");
  check(isHostAllowed("x", "10.0.1.5", ["10.0.0.0/24"]) === false, "fora do CIDR não casa");
  check(isHostAllowed("x", "10.0.0.5", ["10.0.0.5"]) === true, "match por IP exato");
  check(isHostAllowed("x", "192.168.1.1", ["erp.outro.com"]) === false, "hostname diferente não casa por IP");
  check(isHostAllowed("x", "fd00::5", ["fd00::/64"]) === true, "match CIDR IPv6");
  // Sugestão: unwrap de IPv4 mapeado também no matching.
  check(isHostAllowed("x", "::ffff:10.0.0.5", ["10.0.0.0/8"]) === true, "IPv4 mapeado casa com CIDR IPv4");
}

// --- isValidHostEntry (achado 3: prefixos amplos recusados) -----------------
function entryTests() {
  for (const ok of ["erp.cliente.com.br", "localhost", "10.0.0.0/24", "10.0.0.0/16", "10.0.0.5", "192.168.0.0/16", "fc00::/48", "host-com-hifen.ex.com"]) {
    check(isValidHostEntry(ok) === true, `isValidHostEntry(${ok}) deveria ser true`);
  }
  for (const bad of ["", "http://erp.com", "erp com espaco", "10.0.0.0/40", "999.0.0.1/8", "erp.com:8080", "-x.com",
    "0.0.0.0/0", "::/0", "10.0.0.0/8", "172.16.0.0/12", "fc00::/7"]) {
    check(isValidHostEntry(bad) === false, `isValidHostEntry(${bad}) deveria ser false`);
  }
}

// --- assertUrlAllowed -------------------------------------------------------
async function assertTests() {
  const deny = async () => [];
  const resolveTo = (ips) => async () => ips;

  await assertUrlAllowed("https://erp.publico.com/rest", { resolveHost: resolveTo(["200.1.2.3"]), loadAllowedHosts: deny });

  await expectThrow(
    () => assertUrlAllowed("https://interno.cliente.com/rest", { resolveHost: resolveTo(["127.0.0.1"]), loadAllowedHosts: async () => ["interno.cliente.com"] }),
    "ERP_HOST_BLOCKED",
    "loopback resolvido é bloqueado mesmo na lista"
  );

  await expectThrow(
    () => assertUrlAllowed("http://169.254.169.254/latest/meta-data/", { loadAllowedHosts: async () => ["169.254.169.254"] }),
    "ERP_HOST_BLOCKED",
    "metadata literal é bloqueado"
  );

  // Literais exóticos (achado 6): IPv4 mapeado em hex e IPv4 decimal/octal via resolver.
  await expectThrow(
    () => assertUrlAllowed("http://[::ffff:7f00:1]/x", { loadAllowedHosts: deny }),
    "ERP_HOST_BLOCKED",
    "literal IPv4 mapeado em hex (127.0.0.1) é bloqueado"
  );
  await expectThrow(
    () => assertUrlAllowed("http://2130706433/x", { resolveHost: resolveTo(["127.0.0.1"]), loadAllowedHosts: deny }),
    "ERP_HOST_BLOCKED",
    "IPv4 decimal que resolve para loopback é bloqueado"
  );

  await expectThrow(
    () => assertUrlAllowed("https://erp.cliente.com/rest", { resolveHost: resolveTo(["10.1.2.3"]), loadAllowedHosts: deny }),
    "ERP_HOST_NOT_ALLOWED",
    "privado sem liberação é recusado"
  );

  await assertUrlAllowed("https://erp.cliente.com/rest", { resolveHost: resolveTo(["10.1.2.3"]), loadAllowedHosts: async () => ["erp.cliente.com"] });
  await assertUrlAllowed("https://erp.cliente.com/rest", { resolveHost: resolveTo(["10.1.2.3"]), loadAllowedHosts: async () => ["10.1.0.0/16"] });

  await expectThrow(
    () => assertUrlAllowed("https://rebind.cliente.com/rest", { resolveHost: resolveTo(["200.1.2.3", "127.0.0.1"]), loadAllowedHosts: deny }),
    "ERP_HOST_BLOCKED",
    "resolução com loopback entre os IPs é bloqueada"
  );

  await expectThrow(
    () => assertUrlAllowed("https://inexistente.cliente.com/rest", { resolveHost: resolveTo([]), loadAllowedHosts: deny }),
    "ENOTFOUND",
    "host sem resolução dá ENOTFOUND"
  );

  // Achado 3: DENY global (rede interna) vence a allowlist do tenant.
  await expectThrow(
    () => assertUrlAllowed("https://db.interno/rest", {
      resolveHost: resolveTo(["172.18.0.9"]),
      loadAllowedHosts: async () => ["db.interno", "172.18.0.0/16"],
      globalDeny: buildDenyList(["172.18.0.0/16"]),
    }),
    "ERP_HOST_BLOCKED",
    "rede interna da Clarity não é liberável pela lista do tenant"
  );
}

// --- createPinnedLookup (achado 1: IP validado == IP conectado) -------------
async function pinTests() {
  const allowed = ["erp.cliente.com"];

  // Público → devolve o próprio IP ao socket.
  const okPub = await runLookup(createPinnedLookup([], { resolveHost: async () => ["200.1.2.3"] }), "erp.publico.com");
  check(okPub.address === "200.1.2.3" && okPub.family === 4, "lookup devolve IP público aprovado");

  // all:true → devolve array de {address, family}.
  const okAll = await runLookup(createPinnedLookup([], { resolveHost: async () => ["200.1.2.3"] }), "erp.publico.com", { all: true });
  check(Array.isArray(okAll.address) && okAll.address[0].address === "200.1.2.3", "lookup com all:true devolve array");

  // Rebinding: a resolução do PRÓPRIO lookup (a que o socket usa) cai em metadata → rejeita.
  await expectThrow(
    () => runLookup(createPinnedLookup([], { resolveHost: async () => ["169.254.169.254"] }), "rebind.evil.com"),
    "ERP_HOST_BLOCKED",
    "pin: lookup rejeita metadata na resolução de conexão"
  );
  await expectThrow(
    () => runLookup(createPinnedLookup([], { resolveHost: async () => ["127.0.0.1"] }), "rebind.evil.com"),
    "ERP_HOST_BLOCKED",
    "pin: lookup rejeita loopback na resolução de conexão"
  );

  // Privado sem liberação → rejeita; com liberação → aprova só o IP privado.
  await expectThrow(
    () => runLookup(createPinnedLookup([], { resolveHost: async () => ["10.0.0.9"] }), "erp.cliente.com"),
    "ERP_HOST_NOT_ALLOWED",
    "pin: privado sem liberação rejeitado"
  );
  const okPriv = await runLookup(createPinnedLookup(allowed, { resolveHost: async () => ["10.0.0.9"] }), "erp.cliente.com");
  check(okPriv.address === "10.0.0.9", "pin: privado liberado por hostname aprovado");

  // DENY global vence allowlist.
  await expectThrow(
    () => runLookup(createPinnedLookup(["172.18.0.0/16"], { resolveHost: async () => ["172.18.0.9"], globalDeny: buildDenyList(["172.18.0.0/16"]) }), "db.interno"),
    "ERP_HOST_BLOCKED",
    "pin: DENY global vence a allowlist"
  );
}

// --- safeFetch (achados 4 e 6: redirect e remoção de credencial) ------------
function fakeResponse(status, location, text = "") {
  const headers = { location };
  return { status, headers: { get: (n) => headers[String(n).toLowerCase()] ?? null }, text: async () => text };
}

async function safeFetchTests() {
  const baseOpts = {
    method: "GET",
    headers: { Authorization: "Bearer segredo", "X-API-Key": "chave-123", Accept: "application/json" },
    credentialHeaderNames: ["x-api-key"],
  };
  const noDeps = { loadAllowedHosts: async () => [] };

  // Redirect para metadata é barrado ANTES de uma segunda requisição.
  let calls = 0;
  await expectThrow(
    () => safeFetch("https://erp.publico.com/a", baseOpts, {
      ...noDeps,
      requestImpl: async () => { calls += 1; return fakeResponse(302, "http://169.254.169.254/latest/"); },
    }),
    "ERP_HOST_BLOCKED",
    "safeFetch barra redirect para metadata"
  );
  check(calls === 1, `safeFetch não chama o destino do redirect malicioso (chamou ${calls}x)`);

  // Troca de ORIGEM (host) remove Authorization e a API key.
  const seen = [];
  const recorder = (toLocation) => async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return seen.length === 1 ? fakeResponse(302, toLocation) : fakeResponse(200, null, "{}");
  };

  await safeFetch("https://erp.publico.com/a", baseOpts, { ...noDeps, requestImpl: recorder("https://outro.publico.com/b") });
  check(seen[0].headers.Authorization === "Bearer segredo" && seen[0].headers["X-API-Key"] === "chave-123", "1ª requisição leva as credenciais");
  check(seen[1].headers.Authorization === undefined && seen[1].headers["X-API-Key"] === undefined, "troca de host remove Authorization e API key");

  // Troca só de PORTA (mesmo host) também é outra origem → remove credencial (achado 4).
  const seenPort = [];
  const recPort = async (url, opts) => {
    seenPort.push(opts.headers);
    return seenPort.length === 1 ? fakeResponse(302, "https://erp.publico.com:8443/b") : fakeResponse(200, null, "{}");
  };
  await safeFetch("https://erp.publico.com/a", baseOpts, { ...noDeps, requestImpl: recPort });
  check(seenPort[1].Authorization === undefined, "troca de porta remove a credencial");

  // Downgrade de esquema (https→http) é outra origem → remove credencial (achado 4).
  const seenScheme = [];
  const recScheme = async (url, opts) => {
    seenScheme.push(opts.headers);
    return seenScheme.length === 1 ? fakeResponse(302, "http://erp.publico.com/b") : fakeResponse(200, null, "{}");
  };
  await safeFetch("https://erp.publico.com/a", baseOpts, { ...noDeps, requestImpl: recScheme });
  check(seenScheme[1].Authorization === undefined, "downgrade de esquema remove a credencial");

  // Mesma origem mantém a credencial.
  const seenSame = [];
  const recSame = async (url, opts) => {
    seenSame.push(opts.headers);
    return seenSame.length === 1 ? fakeResponse(302, "https://erp.publico.com/outro") : fakeResponse(200, null, "{}");
  };
  await safeFetch("https://erp.publico.com/a", baseOpts, { ...noDeps, requestImpl: recSame });
  check(seenSame[1].Authorization === "Bearer segredo", "redirect na mesma origem mantém a credencial");
}

// --- Integração REAL: o lookup pinado é o usado na conexão (achado 1) --------
// Sem stub de requestImpl: exercita rawRequest de verdade contra um servidor
// local. Se alguém remover o `lookup` de transport.request, a conexão a
// localhost (→127.0.0.1) é aberta e o servidor recebe a requisição — este teste
// então fica VERMELHO (counter > 0 e sem ERP_HOST_BLOCKED).
async function realPathTests() {
  let received = 0;
  const server = http.createServer((req, res) => {
    received += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const opts = { method: "GET", headers: { Accept: "*/*" } };
    const deps = { loadAllowedHosts: async () => [] };
    // Caminho REAL (requestImpl padrão = rawRequest, DNS real, lookup pinado).
    await expectThrow(
      () => safeFetch(`http://localhost:${port}/`, opts, deps),
      "ERP_HOST_BLOCKED",
      "safeFetch real: localhost (→127.0.0.1) barrado pelo lookup pinado"
    );
    await expectThrow(
      () => safeFetch(`http://[::ffff:127.0.0.1]:${port}/`, opts, deps),
      "ERP_HOST_BLOCKED",
      "safeFetch real: literal IPv4-mapeado de loopback é barrado"
    );
    check(received === 0, `servidor local NÃO deve receber requisição (recebeu ${received})`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- crypto passphrase ------------------------------------------------------
function cryptoTests() {
  const secret = "s3nh4-do-erp-protheus";
  const envelope = encryptWithPassphrase(secret, "arquivo-forte-123");
  check(envelope.startsWith("scrypt:"), "envelope começa com scrypt:");
  check(!envelope.includes(secret), "texto puro não aparece no envelope");
  check(decryptWithPassphrase(envelope, "arquivo-forte-123") === secret, "roundtrip com a senha certa");

  let threw = false;
  try { decryptWithPassphrase(envelope, "senha-errada"); } catch { threw = true; }
  check(threw, "senha errada falha ao decifrar");

  let threw2 = false;
  try { decryptWithPassphrase("texto-puro", "qualquer"); } catch { threw2 = true; }
  check(threw2, "payload fora do formato falha");
}

async function main() {
  classifyTests();
  allowTests();
  entryTests();
  await assertTests();
  await pinTests();
  await safeFetchTests();
  await realPathTests();
  cryptoTests();

  if (failures.length) {
    console.error(`SSRF/export integrações: ${failures.length} falha(s)`);
    for (const message of failures) console.error(` - ${message}`);
    process.exit(1);
  }
  console.log("SSRF/export integrações ok: IPs e IPv6 embutido classificados, allowlist com teto e DENY global, pin de IP anti-rebinding, redirect por origem removendo credencial e export cifrado");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
