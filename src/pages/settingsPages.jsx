import { SettingsView } from "./Settings";

export function SettingsIntegrations() {
  return <SettingsView section="integracoes" />;
}

export function SettingsSchedules() {
  return <SettingsView section="agendamento" />;
}

export function SettingsParameters() {
  return <SettingsView section="parametros" />;
}

export function SettingsUsers() {
  return <SettingsView section="usuarios" />;
}

export function SettingsLog() {
  return <SettingsView section="log" />;
}

export function SettingsAccount() {
  return <SettingsView section="conta" />;
}
