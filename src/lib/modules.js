// Módulos opcionais liberados por usuário (tenant_users.permissions). Espelha hasModule() do backend:
// só o master tem acesso automático; todos os demais, inclusive o proprietário, dependem da chave ligada.
export const MODULES = [
  { key: "tax", label: "Gestão Tributária", description: "Parcelamentos de tributos, guias e planejamento de vencimentos" },
];

export function hasModule(user, key) {
  if (!user) return false;
  if (user.platform_admin) return true;
  return user.permissions?.[key] === true;
}
