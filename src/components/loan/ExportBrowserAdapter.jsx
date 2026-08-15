/**
 * 🔐 EXPORT BROWSER ADAPTER — ETAPA 4A
 * 
 * Adapter para operações de UI/side-effects (download)
 * Manter orchestrator puro, side-effects isolados neste arquivo
 */

/**
 * Exporta pacote para arquivo (download no navegador)
 * 🔐 ETAPA 4A: Isolado de orchestrator (side-effect)
 * @param {Object} pkg - Output de generateExportPackage()
 * @param {string} format - "json" ou "csv"
 * @param {string} filename - Nome do arquivo
 */
export function downloadExport(pkg, format = "json", filename = "financial_export") {
  if (!pkg) {
    throw new Error("[EXPORT_ADAPTER] Package inválido");
  }

  let content, mimeType;

  if (format === "json") {
    content = JSON.stringify(pkg, null, 2);
    mimeType = "application/json";
  } else if (format === "csv") {
    if (!pkg.accounting?.formatted) {
      throw new Error("[EXPORT_ADAPTER] Accounting data não disponível para CSV export");
    }
    content = pkg.accounting.formatted;
    mimeType = "text/csv";
  } else {
    throw new Error(`[EXPORT_ADAPTER] Formato não suportado: ${format}`);
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copia pacote para clipboard (JSON)
 * @param {Object} pkg - Output de generateExportPackage()
 */
export async function copyExportToClipboard(pkg) {
  try {
    const content = JSON.stringify(pkg, null, 2);
    await navigator.clipboard.writeText(content);
    return { success: true, message: "Pacote copiado para clipboard" };
  } catch (error) {
    return { success: false, message: `Erro ao copiar: ${error.message}` };
  }
}

export default { downloadExport, copyExportToClipboard };