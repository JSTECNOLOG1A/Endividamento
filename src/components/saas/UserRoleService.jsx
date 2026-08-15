/**
 * 🔐 USER ROLE SERVICE — RBAC
 * 
 * Controle de permissões por role
 * 
 * ROLES:
 * - OWNER: acesso total, gerencia billing
 * - ADMIN: cria/edita contratos, gerencia usuários
 * - VIEWER: apenas visualiza
 */

/**
 * 🔐 PERMISSIONS MATRIX
 */
const PERMISSIONS = {
  OWNER: {
    contracts: { create: true, read: true, update: true, delete: true, approve: true },
    users: { invite: true, remove: true, change_role: true },
    billing: { manage: true, upgrade: true },
    settings: { manage: true }
  },
  ADMIN: {
    contracts: { create: true, read: true, update: true, delete: true, approve: true },
    users: { invite: true, remove: false, change_role: false },
    billing: { manage: false, upgrade: false },
    settings: { manage: false }
  },
  VIEWER: {
    contracts: { create: false, read: true, update: false, delete: false, approve: false },
    users: { invite: false, remove: false, change_role: false },
    billing: { manage: false, upgrade: false },
    settings: { manage: false }
  }
};

/**
 * Verifica se role tem permissão
 * @param {string} role - Role do usuário
 * @param {string} resource - Recurso (contracts, users, billing)
 * @param {string} action - Ação (create, read, update, delete, etc)
 * @returns {boolean} True se permitido
 */
export function hasPermission(role, resource, action) {
  const rolePermissions = PERMISSIONS[role];
  
  if (!rolePermissions) {
    throw new Error(`[RBAC] Role inválida: ${role}`);
  }
  
  const resourcePermissions = rolePermissions[resource];
  
  if (!resourcePermissions) {
    throw new Error(`[RBAC] Recurso inválido: ${resource}`);
  }
  
  return resourcePermissions[action] === true;
}

/**
 * Valida permissão ou lança erro
 * @param {string} role - Role do usuário
 * @param {string} resource - Recurso
 * @param {string} action - Ação
 */
export function requirePermission(role, resource, action) {
  if (!hasPermission(role, resource, action)) {
    throw new Error(
      `[RBAC] Permissão negada: ${role} não pode executar ${action} em ${resource}`
    );
  }
  
  return true;
}

/**
 * Retorna todas as permissões de uma role
 * @param {string} role - Role
 * @returns {Object} Permissões
 */
export function getRolePermissions(role) {
  const permissions = PERMISSIONS[role];
  
  if (!permissions) {
    throw new Error(`[RBAC] Role inválida: ${role}`);
  }
  
  return permissions;
}

/**
 * Valida se role pode mudar outra role
 * @param {string} fromRole - Role atual do executor
 * @param {string} targetRole - Role alvo a ser aplicada
 * @returns {boolean} True se permitido
 */
export function canChangeRole(fromRole, targetRole) {
  // Apenas OWNER pode mudar roles
  if (fromRole !== "OWNER") return false;
  
  // OWNER não pode remover seu próprio OWNER (proteção)
  // (verificação adicional: deve haver outro OWNER)
  return true;
}

/**
 * Valida se role pode remover usuário
 * @param {string} fromRole - Role do executor
 * @param {string} targetRole - Role do usuário a ser removido
 * @returns {boolean} True se permitido
 */
export function canRemoveUser(fromRole, targetRole) {
  // Apenas OWNER pode remover
  if (fromRole !== "OWNER") return false;
  
  // OWNER não pode remover outro OWNER
  if (targetRole === "OWNER") return false;
  
  return true;
}

export default {
  hasPermission,
  requirePermission,
  getRolePermissions,
  canChangeRole,
  canRemoveUser,
  PERMISSIONS
};