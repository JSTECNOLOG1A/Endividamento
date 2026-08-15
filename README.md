# FinCalc — Endividamento

Sistema local de cálculo e gestão de empréstimos e financiamentos (SAC, PRICE, AMERICANO, BULLET), com governança, contabilidade CPC 26 e consolidação por grupo econômico.

Backend SQLite + API Express. Sem dependência da Base44.

## Requisitos

- Node.js 20+
- npm

## Como rodar

```bash
npm install
npm run dev
```

- Interface: http://localhost:5173
- API: http://127.0.0.1:3001/api/health

O banco é criado em `server/data/fincalc.sqlite` na primeira execução (arquivo ignorado pelo Git).

## Scripts

| Comando | Função |
| --- | --- |
| `npm run dev` | API + frontend juntos |
| `npm run dev:server` | Só a API |
| `npm run dev:client` | Só o Vite |
| `npm run build` | Build de produção do frontend |

## O que não vai para o Git

- `node_modules`
- `server/data` (SQLite)
- `server/uploads`
- `.env` / `.env.local`
