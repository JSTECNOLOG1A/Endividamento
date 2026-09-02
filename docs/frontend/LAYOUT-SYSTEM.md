# Sistema de Layouts — AllDebt

**Versão:** 1.0 (Modern V2)  
**Data:** 2026-09-02

## Visão geral

O AllDebt suporta dois shells de navegação independentes:

| Layout | Descrição |
|--------|-----------|
| **ClassicLayout** | Layout de produção homologado (header horizontal). Inalterado visualmente. |
| **ModernLayout** | Shell SaaS B2B com sidebar, header, breadcrumb e identidade moderna. |

As **páginas internas não são duplicadas**. Apenas o chrome muda.

```
AppLayout
  ├─ classic → ClassicLayout → {children} (mesmas páginas)
  └─ modern  → ModernLayout  → {children}
```

## Resolução via parâmetro

Parâmetro: `appearance.default_layout`  
Valores: `classic` | `modern`  
Default: **`classic`**

Precedência (backend): USER → TENANT → GLOBAL → catálogo → fallback `classic`

### Fluxo no frontend

1. Login / boot → `LayoutProvider` busca `GET /api/parameters/appearance.default_layout`
2. Cache local: `localStorage alldebt:layout:{groupId}`
3. `AppLayout` renderiza Classic ou Modern
4. Ao salvar layout em **Configurações → Parâmetros** → **reload controlado**

### Fallback

| Condição | Resultado |
|----------|-----------|
| API indisponível | cache local ou `classic` |
| Valor inválido | `classic` |
| Parâmetro ausente | `classic` |
| Master sem tenant | GLOBAL/default → `classic` |

## Estrutura de arquivos

```
src/
├── layouts/
│   ├── AppLayout.jsx          # Resolvedor
│   ├── classic/
│   │   └── ClassicLayout.jsx  # Shell clássico (conteúdo original)
│   └── modern/
│       ├── ModernLayout.jsx
│       ├── ModernSidebar.jsx
│       ├── ModernHeader.jsx
│       ├── ModernBreadcrumb.jsx
│       ├── ModernUserMenu.jsx
│       ├── ModernTenantBadge.jsx
│       └── ModernMobileNavigation.jsx
├── config/navigation.js       # NAV_ITEMS compartilhado (sequência idêntica)
├── lib/
│   ├── LayoutContext.jsx      # Provider + fetch do parâmetro
│   └── layoutMode.js          # resolveLayoutMode + cache
└── Layout.jsx                 # Re-export Classic (compatibilidade)
```

## ClassicLayout

- Encapsula o layout original homologado
- Injeta CSS global `border-radius: 0` e `white-space: nowrap` em tabelas
- **Não deve ser alterado** salvo correções críticas

## ModernLayout

### Paleta

- Primary `#0B5FFF`
- Cyan `#06B6D4`
- Sidebar `#071A2F`
- Background `#F7F9FC`
- Text `#172033`

### Sidebar

- 252px expandida / 68px recolhida
- Collapse persistido: `localStorage alldebt:sidebar-collapsed:{userId}`
- Mobile: drawer (`Sheet`)

### Header

- Breadcrumb contextual
- Tenant badge (`Building2`)
- Notificações (estado vazio honesto)
- Menu do usuário

### Master / LGPD

- Banner amber adaptado (mesmo texto LGPD)
- Badge "Acesso Master" discreto

## Segurança

- Frontend **não decide** tenant — `group_id` vem do JWT/backend
- Alteração de parâmetros tenant: apenas administradores (backend)
- Usuários comuns apenas **consomem** o layout resolvido

## Testes

```bash
node src/lib/layoutMode.test.mjs          # resolução + fallback
npm run test:parameters                   # isolamento tenant (backend)
npm run test:engine && npm run test:p0    # regressão
npm run build                             # frontend
```

## Como escolher layout

**Configurações → Parâmetros → Layout padrão → Clássico / Moderno → Salvar**

O sistema recarrega automaticamente ao alterar o layout.

## Regra de ouro

> O Layout Moderno é **adicional**. O Clássico permanece default e pixel-equivalente ao homologado.
