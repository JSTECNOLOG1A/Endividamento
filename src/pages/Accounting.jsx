import React from "react";
import AccountingReading from "../components/accounting/AccountingReading";

// As telas antigas (Analítica, Mapa Clássico, Mapa Período, Tradicional)
// foram removidas — a Leitura Contábil passou a ser a única tela do módulo
// contábil, cobrindo posição, competência e fluxo futuro num único lugar.
export default function Accounting() {
  return <AccountingReading />;
}
