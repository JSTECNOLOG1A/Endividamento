import React from "react";
import DashboardView from "@/components/dashboard/DashboardView";

// A rota/arquivo continua "Consolidation" (pages.config.js é auto-gerado a partir do nome do arquivo em
// ./pages/ — trocar o nome exigiria mexer nesse gerador); o rótulo visível ("Dashboard") muda só na
// sidebar (src/config/navigation.js).
export default function Consolidation() {
  return <DashboardView />;
}
