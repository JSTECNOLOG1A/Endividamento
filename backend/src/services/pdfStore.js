import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Guarda de PDFs de um módulo numa pasta própria dentro do diretório de uploads. Fica fora do /api/uploads
// genérico de propósito: aquele grava por tenant e serve qualquer arquivo pelo nome; aqui cada arquivo pertence
// a um registro do módulo e só sai pelas rotas dele, que conferem o dono antes.
// A chave é montada pelo módulo e conferida contra `keyPattern`: nada vindo do usuário entra no caminho.

const PDF_SIGNATURE = Buffer.from("%PDF-", "latin1");

export function isPdf(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length > PDF_SIGNATURE.length
    && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

/**
 * @param {object} options
 * @param {string} options.folder subpasta dentro de config.uploadDir
 * @param {RegExp} options.keyPattern formato aceito da chave "<pasta do registro>/<arquivo>.pdf"
 * @param {string} options.label nome do conteúdo nos logs (ex.: "proposta comercial")
 */
export function createPdfStore({ folder, keyPattern, label }) {
  function baseDir() {
    // Lido a cada chamada: o diretório vem de config, que o teste redireciona.
    return path.resolve(config.uploadDir, folder);
  }

  // Caminho absoluto de uma chave gravada no banco, recusando qualquer coisa que escape da pasta do módulo.
  function resolve(key) {
    if (!keyPattern.test(String(key || ""))) throw new Error("chave de arquivo inválida");
    const root = baseDir();
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`chave de arquivo fora da pasta de ${label}`);
    return target;
  }

  async function save(key, buffer) {
    if (!keyPattern.test(key)) throw new Error(`chave de arquivo inválida: ${key}`);
    const target = path.join(baseDir(), key);
    // A pasta do registro pode ser removida por outra operação que acabou de esvaziá-la (remove) entre o mkdir
    // e a escrita: recria e tenta de novo em vez de falhar.
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

  // rmdir só remove pasta vazia, e a checagem é do próprio sistema de arquivos: se outra operação gravou algo
  // na pasta, ela fica (ENOTEMPTY). Nada aqui derruba a resposta — pasta que sobrou é só resíduo.
  async function removeFolderIfEmpty(dir) {
    try {
      await fs.rmdir(dir);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
        logger.error({ err: error, dir }, `falha ao remover pasta vazia de ${label}`);
      }
    }
  }

  async function remove(key) {
    if (!key) return;
    let target;
    try {
      target = resolve(key);
      await fs.unlink(target);
    } catch (error) {
      if (error?.code !== "ENOENT") logger.error({ err: error, key }, `falha ao remover arquivo de ${label}`);
    }
    if (target) await removeFolderIfEmpty(path.dirname(target));
  }

  async function exists(key) {
    try {
      const stat = await fs.stat(resolve(key));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  return { save, remove, resolve, exists };
}
