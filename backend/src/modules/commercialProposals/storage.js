import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { logger } from "../../logger.js";

// Pasta própria das propostas, dentro do diretório de uploads. Fica fora do
// /api/uploads genérico de propósito: aquele grava por tenant (e em "orphan"
// para a equipe da plataforma) e serve qualquer arquivo pelo nome; aqui cada
// arquivo pertence a uma proposta e só sai pelas rotas do módulo.
const FOLDER = "commercial-proposals";
const PDF_SIGNATURE = Buffer.from("%PDF-", "latin1");
// Chave = "<id da proposta>/<tipo>-<uuid>.pdf". Nada vindo do usuário entra
// no caminho: o nome original só é guardado no banco, para o download.
const KEY_PATTERN = /^[0-9a-f-]{36}\/(assinado|enviado)-[0-9a-f-]{36}\.pdf$/;

function baseDir() {
  // Lido a cada chamada: o diretório vem de config, que o teste redireciona.
  return path.resolve(config.uploadDir, FOLDER);
}

export function isPdf(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length > PDF_SIGNATURE.length
    && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

export async function saveProposalFile(proposalId, kind, buffer) {
  const key = `${proposalId}/${kind}-${randomUUID()}.pdf`;
  if (!KEY_PATTERN.test(key)) throw new Error(`chave de arquivo inválida: ${key}`);
  const target = path.join(baseDir(), key);
  // A pasta da proposta pode ser removida por outra operação que acabou de
  // esvaziá-la (removeProposalFile) entre o mkdir e a escrita: recria e tenta
  // de novo em vez de falhar.
  for (let attempt = 1; ; attempt += 1) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      // "wx": nunca sobrescreve um arquivo já guardado.
      await fs.writeFile(target, buffer, { flag: "wx" });
      return { key, size: buffer.length };
    } catch (error) {
      if (error?.code !== "ENOENT" || attempt >= 3) throw error;
    }
  }
}

export async function removeProposalFile(key) {
  if (!key) return;
  let target;
  try {
    target = resolveProposalFile(key);
    await fs.unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") logger.error({ err: error, key }, "falha ao remover arquivo de proposta comercial");
  }
  if (target) await removeFolderIfEmpty(path.dirname(target));
}

// rmdir só remove pasta vazia, e a checagem é do próprio sistema de arquivos:
// se outra operação gravou algo na pasta, ela fica (ENOTEMPTY). Nada aqui
// derruba a resposta — pasta que sobrou é só resíduo.
async function removeFolderIfEmpty(dir) {
  try {
    await fs.rmdir(dir);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
      logger.error({ err: error, dir }, "falha ao remover pasta vazia de proposta comercial");
    }
  }
}

// Caminho absoluto de uma chave gravada no banco, recusando qualquer coisa
// que escape da pasta das propostas.
export function resolveProposalFile(key) {
  if (!KEY_PATTERN.test(String(key || ""))) throw new Error("chave de arquivo inválida");
  const root = baseDir();
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("chave de arquivo fora da pasta de propostas");
  return target;
}

export async function proposalFileExists(key) {
  try {
    const stat = await fs.stat(resolveProposalFile(key));
    return stat.isFile();
  } catch {
    return false;
  }
}
