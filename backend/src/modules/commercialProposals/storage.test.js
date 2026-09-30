import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import { saveProposalFile } from "./storage.js";

function fail(message) {
  throw new Error(message);
}

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n", "latin1");

// storage.js chama fs.mkdir/fs.writeFile pelo objeto de node:fs/promises a
// cada uso; trocar o método aqui troca o que ele chama. `vanishAfterMkdir`
// decide, por chamada, se a pasta some logo depois de criada — o mesmo efeito
// de outra operação que esvaziou e removeu a pasta nesse intervalo.
async function withVanishingFolder(vanishAfterMkdir, fn) {
  const realMkdir = fsp.mkdir;
  const realWriteFile = fsp.writeFile;
  const calls = { mkdir: 0, writeFile: 0 };
  fsp.mkdir = async (dir, options) => {
    calls.mkdir += 1;
    const result = await realMkdir.call(fsp, dir, options);
    if (vanishAfterMkdir(calls.mkdir)) await fsp.rmdir(dir);
    return result;
  };
  fsp.writeFile = async (...args) => {
    calls.writeFile += 1;
    return realWriteFile.apply(fsp, args);
  };
  try {
    return { calls, outcome: await fn().then((value) => ({ value }), (error) => ({ error })) };
  } finally {
    fsp.mkdir = realMkdir;
    fsp.writeFile = realWriteFile;
  }
}

async function main() {
  const previousUploadDir = config.uploadDir;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-storage-"));
  config.uploadDir = uploadDir;
  try {
    // (a) A pasta some depois do 1º mkdir: a 1ª escrita dá ENOENT, a 2ª
    // tentativa recria a pasta e grava.
    const recoveredId = randomUUID();
    const recovered = await withVanishingFolder((n) => n === 1, () => saveProposalFile(recoveredId, "enviado", PDF));
    if (recovered.outcome.error) fail(`pasta que sumiu uma vez deveria ser recriada: ${recovered.outcome.error.code || recovered.outcome.error.message}`);
    if (recovered.calls.mkdir !== 2 || recovered.calls.writeFile !== 2) {
      fail(`recuperação: esperado 2 mkdir e 2 escritas, houve ${recovered.calls.mkdir} e ${recovered.calls.writeFile}`);
    }
    const saved = path.join(uploadDir, "commercial-proposals", recovered.outcome.value.key);
    if (!fs.existsSync(saved) || !fs.readFileSync(saved).equals(PDF)) fail("recuperação não gravou o PDF inteiro");
    if (recovered.outcome.value.size !== PDF.length) fail(`tamanho devolvido: ${recovered.outcome.value.size}`);

    // (b) A pasta some depois de todo mkdir: desiste na 3ª tentativa e
    // propaga o ENOENT, sem gravar nada.
    const givenUpId = randomUUID();
    const givenUp = await withVanishingFolder(() => true, () => saveProposalFile(givenUpId, "enviado", PDF));
    if (!givenUp.outcome.error) fail("pasta que sempre some deveria fazer a gravação falhar");
    if (givenUp.outcome.error.code !== "ENOENT") fail(`erro propagado: ${givenUp.outcome.error.code || givenUp.outcome.error.message}`);
    if (givenUp.calls.mkdir !== 3 || givenUp.calls.writeFile !== 3) {
      fail(`desistência: esperado exatamente 3 tentativas, houve ${givenUp.calls.mkdir} mkdir e ${givenUp.calls.writeFile} escritas`);
    }
    if (fs.existsSync(path.join(uploadDir, "commercial-proposals", givenUpId))) fail("desistência deixou pasta no disco");

    console.log("commercialProposals storage ok: pasta que some é recriada; desiste em 3 tentativas com ENOENT");
  } finally {
    config.uploadDir = previousUploadDir;
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
