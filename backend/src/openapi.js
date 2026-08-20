import { ENTITIES } from "./modules/entities/catalog.js";

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Endividamento API",
    version: "1.0.0",
    description: "API relacional do Endividamento. Datas ISO 8601, moedas ISO 4217, auditoria append-only.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: { summary: "Liveness", security: [], responses: { 200: { description: "OK" } } },
    },
    "/ready": {
      get: { summary: "Readiness (Postgres)", security: [], responses: { 200: { description: "OK" } } },
    },
    "/auth/login": {
      post: { summary: "Login JWT", security: [], responses: { 200: { description: "token + user" } } },
    },
    "/auth/me": {
      get: { summary: "Usuário autenticado", responses: { 200: { description: "user" } } },
    },
    "/entities/{name}": {
      get: { summary: "Listar entidade", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", enum: Object.keys(ENTITIES) } }] },
      post: { summary: "Criar entidade" },
    },
    "/groups": { get: { summary: "Grupos econômicos (alias REST)" } },
    "/contracts": { get: { summary: "Contratos (alias REST)" } },
    "/functions/{name}": {
      post: {
        summary: "Funções: calculateAmortizationSchedule, getPTAXFromBACEN, getRatesFromBACEN, validateAllApprovedContracts",
      },
    },
    "/integrations": {
      get: { summary: "Listar conexões de API / ERP" },
      post: { summary: "Criar conexão de API" },
    },
    "/integrations/test-connection": {
      post: { summary: "Testar conexão com o ERP (não persiste dados)" },
    },
    "/integrations/{code}": {
      get: { summary: "Obter conexão" },
      put: { summary: "Atualizar conexão" },
      delete: { summary: "Excluir conexão" },
    },
    "/schedules": {
      get: { summary: "Listar agendamentos" },
      post: { summary: "Criar agendamento" },
    },
    "/schedules/run-task": {
      post: { summary: "Executar tarefa agora (manual)" },
    },
  },
};
