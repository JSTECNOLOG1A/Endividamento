import { parentPort, workerData } from "node:worker_threads";
import { extractText, getDocumentProxy } from "unpdf";

// Extração do texto da guia em PDF, isolada numa thread: quem a criou pode encerrá-la a qualquer momento (tempo
// esgotado), inclusive no meio de um processamento que não devolve o controle. Responde uma mensagem só.

async function run() {
  const { buffer, maxPages } = workerData;
  const document = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
  try {
    if (document.numPages > maxPages) return { tooManyPages: true, pages: document.numPages };
    const { text } = await extractText(document, { mergePages: true });
    return { text: text || "" };
  } finally {
    await document.loadingTask.destroy().catch(() => {});
  }
}

run().then(
  (result) => parentPort.postMessage(result),
  (error) => parentPort.postMessage({ error: { name: error?.name || "Error", message: error?.message || String(error) } })
);
