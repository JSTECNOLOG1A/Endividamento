# Archive

Pasta de **artefatos históricos** que não fazem parte do runtime da aplicação AllDebt/Endividamento.

Nada aqui deve ser importado, referenciado ou executado por Docker, npm, Vite, Express ou CI.

## `bundles/`

Contém **Git bundles** (`.bundle`) criados manualmente em sessões de desenvolvimento anteriores. São backups portáteis de trechos do histórico Git — úteis para recuperação offline, mas **redundantes** quando os commits já existem no repositório remoto/local.

- Não são lidos pela aplicação em produção.
- Não entram no build do frontend nem no boot da API.
- Foram movidos da raiz do repositório na **Etapa A** da reorganização (ver `docs/architecture/REPOSITORY-REORGANIZATION-PLAN.md`).

Para inspecionar um bundle:

```bash
git bundle verify archive/bundles/<nome>.bundle
git bundle list-heads archive/bundles/<nome>.bundle
```

## `orphans/`

Arquivos de **0 bytes** que apareceram na raiz por engano (comandos digitados incorretamente no terminal, por exemplo `main`, `node`, `cd`, `git`, `docker`). Não têm função no projeto.

Candidatos a **remoção definitiva do Git** na Etapa H, após confirmação final.

## Política

- Novos backups Git devem ir para `archive/bundles/` (ou fora do repositório), **não** para a raiz.
- Não adicionar código de produção, configuração ou dependências nesta pasta.
