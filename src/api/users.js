import { apiRequest } from "./base44Client";

export const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador" },
  { value: "user", label: "Usuário" },
  { value: "viewer", label: "Visualizador" },
];

export const YES_NO_OPTIONS = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

export function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role || "—";
}

export function blockedLabel(blocked) {
  return blocked ? "Sim" : "Não";
}

export const usersApi = {
  list() {
    return apiRequest("/users");
  },
  create(data) {
    return apiRequest("/users", { method: "POST", body: data });
  },
  update(id, data) {
    return apiRequest(`/users/${id}`, { method: "PUT", body: data });
  },
  resendInvite(id) {
    return apiRequest(`/users/${id}/invite`, { method: "POST" });
  },
};
