# radar-pluggy

Serviço TypeScript que integra com a Pluggy (Open Finance), complementar ao `oplab-radar`. Detalhes de
arquitetura e decisões em `openspec/changes/` e `PENDENCIAS.md`.

## Estado

Serviço standalone com credencial própria (`radar_pluggy_credentials`, cifrada), cadastro de
credencial (`POST /credentials`, provisiona o webhook no mesmo passo), webhook reativo (recepção,
inbox durável, dreno e reconciliação manual), sincronização de posição e carga histórica a partir da
Pluggy, e `GET /healthcheck`. Estrutura de pastas e regra de dependência em `arquitetura-camadas`;
regra fiscal e de domínio Pluggy em `fronteira-pluggy`.

Artefato de deploy (Docker, GHCR, `.railway/railway.ts`, migração via `DATABASES`), configuração que recusa
ausência em vez de default (`config.json`/`databases.json` ou `CONFIG`/`DATABASES`) e ferramental
de dev local (`Makefile`, `docker-compose`) já publicados.

## Pendências conhecidas

Ver `PENDENCIAS.md` — hoje restam apenas itens cross-repo (repontar o webhook de produção da Pluggy
para cá e remover a rota antiga no `oplab-radar-api`).
