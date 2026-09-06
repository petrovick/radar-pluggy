## Context

`Dockerfile` (multi-stage: `build`/`dev`/`runtime`) e `railway.json` (`builder: DOCKERFILE`) já existem, mas nenhum serviço no Railway jamais os usou — o `radar-pluggy` nunca foi implantado. O workspace já tem um padrão de deploy diferente (`oplab-radar-api`/`-front`, builder `RAILPACK`, repo GitHub conectado direto, sem Docker/GHCR) — este change diverge dele deliberadamente, por decisão explícita.

O formato `railway.json`/`.toml` (Config as Code) está deprecated, com corte total (hard cutoff) em **2026-12-01** — confirmado em `docs.railway.com/config-as-code`. O substituto, Infrastructure as Code (`.railway/railway.ts` + `railway config plan`/`apply`), gerencia o projeto inteiro declarativamente, inclusive criando o serviço do zero com fonte de imagem Docker. Ver `proposal.md` pra motivação completa.

**Correção de rota, registrada durante a implementação**: o projeto Railway `oplab-radar` tinha um único ambiente, `production`, com `oplab-radar-api`/`oplab-radar-front` rodando de verdade nele (domínio próprio, tráfego real). Ao preparar o terreno pra este change, esse ambiente foi **renomeado** para `staging` — não um ambiente novo criado ao lado (mesmo ID de ambiente antes e depois). Decisão explícita do usuário, ciente do risco: `radar-pluggy` passa a compartilhar ambiente com os dois serviços que já rodam em produção, em vez de subir num sandbox isolado. Não há mais um ambiente `production` separado neste projeto.

## Goals / Non-Goals

**Goals:**
- `radar-pluggy` rodando de verdade num ambiente Railway `staging`, imagem vinda do GHCR, redeployado a cada push em `main` sem clique manual no dashboard.
- Nascer direto em `.railway/railway.ts` (não em `railway.json`), já que o serviço começa do zero e o formato antigo desliga em três meses.
- Migration (`preDeploy`) continua funcionando como funcionaria sob `railway.json` — mesma imagem de runtime, mesmo comando, só o `--env` muda.

**Non-Goals:**
- Isolamento de `radar-pluggy` frente a `oplab-radar-api`/`oplab-radar-front` — não existe mais essa fronteira neste projeto Railway (ver Context); os três serviços vivem no mesmo (único) ambiente. Recriar essa separação, se algum dia for pedida, é um change à parte — não desenhado agora.
- Marcar o pacote GHCR como público — ação manual de GitHub, listada como pré-requisito em `tasks.md`.

## Decisions

1. **GHCR em vez do builder nativo do Railway** — já decidido: builda no CI, Railway só consome imagem pronta. Alternativa (manter `builder: DOCKERFILE`, zero peça nova) descartada explicitamente — é a própria premissa do change.

2. **Pacote GHCR público, sem credencial de registry no Railway** — funciona em qualquer plano Railway (credenciais de registry privado exigem plano Pro, `docs.railway.com/builds/private-registries`). Alternativa (pacote privado + PAT) descartada: exigiria confirmar o plano da conta, sem necessidade real — a imagem não carrega segredo nenhum (tudo entra por env var, não por `COPY`, conforme os próprios comentários do `Dockerfile`).

3. **Tag mutável `:staging` + redeploy disparado pelo CI** — "Option 1: a mutable tag plus a CI redeploy" da doc oficial do Railway (`docs.railway.com/guides/private-container-registry`). Descartadas: "Option 2: image auto updates" (polling em janela de manutenção, indicada pela própria doc pra dependências consumidas como banco/proxy, não pra app própria que precisa de deploy imediato) e "Option 3: unique tags + staged update" (precisão de rollback por digest que este projeto não precisa agora — pode ser adotada depois sem mudar o formato do pipeline, já que a tag imutável abaixo já existe).
   Cada build também publica uma tag imutável `ghcr.io/petrovick/radar-pluggy:sha-<hash-curto>` apontando pro mesmo digest — se `:staging` se comportar mal, o commit exato que gerou a imagem em produção continua identificável no pacote GHCR, sem adotar a Option 3 inteira.

4. **Chamada de redeploy**: último passo do CI roda `npx -y @railway/cli@latest redeploy --service radar-pluggy --yes`, autenticado por `RAILWAY_TOKEN` (project token escopado ao ambiente `staging`) — padrão documentado da própria Option 1, confirmado a forçar novo pull do digest atual da tag mutável (não reaproveita build anterior).

5. **Pular `railway.json`, nascer direto em `.railway/railway.ts`** — o formato antigo nunca configurou um serviço vivo aqui (nada a migrar) e desliga em 2026-12-01; escrever config nova num formato com três meses de vida é trabalho perdido. O arquivo novo também modela melhor a necessidade de dois ambientes (idioma `ctx.environment === "production"`) do que o formato antigo (um serviço por arquivo).

6. **Forma de `.railway/railway.ts`**: começa com `export const partial = "radar-pluggy"` — o projeto Railway `oplab-radar` já tem `oplab-radar-api`/`oplab-radar-front`, que vivem em **outro repositório** e não são declarados neste arquivo. `partial` é o mecanismo documentado da própria Railway pra exatamente esse caso (repos separados que não compartilham um `railway.ts` único): sem ele, `config apply` trataria este arquivo como a fonte de verdade do projeto inteiro e reconciliaria (na prática, poderia remover) qualquer serviço não declarado nele — os outros dois serviços incluídos.
   Depois do `partial`, um único `service("radar-pluggy", …)`, fonte `image("ghcr.io/petrovick/radar-pluggy:staging")`, `healthcheck: "/healthcheck"`, `preDeploy: "node node_modules/sequelize-cli/lib/sequelize db:migrate --env staging"` (mesmo comando que estava no `preDeployCommand` do `railway.json`, só troca o `--env`), e bloco `env` para `NODE_ENV`, `CONFIG`, `DATABASES`, `PLUGGY_CREDENTIAL_ENCRYPTION_KEY`.
   `DATABASES` é `'${{oplab-radar-api.DATABASES}}'` — referência resolvida pelo Railway, não `preserve()`: decisão do usuário de reaproveitar o mesmo banco físico (`oplab_radar`, mesmo Aiven) que `oplab-radar-api` já usa neste ambiente, em vez de provisionar um banco novo. O valor real nunca passa em texto puro por este arquivo, pelo agente ou pelo repositório. `CONFIG`/`PLUGGY_CREDENTIAL_ENCRYPTION_KEY` continuam `preserve()` — são segredos próprios do `radar-pluggy`, não compartilhados, setados direto no dashboard/API (task 3.2) — assim `config apply` nunca os sobrescreve com valor vazio a cada reaplicação da estrutura (mesmo padrão do exemplo oficial, `JWT_SECRET: preserve()`).
   O mesmo arquivo, aplicado depois contra um ambiente `production`, estende isso via `ctx.environment` sem duplicar estrutura — mas isso fica pro change de `production`, não é desenhado agora.

7. **`.railway/railway.ts` aplicado via a GitHub Action `railwayapp/config`, em fluxo de dois jobs** (`plan` no PR, comentado; `apply` no merge) — padrão documentado da própria action. Isso separa mudança estrutural (rara, passa por review) do redeploy do dia a dia (rotineiro, sem gate — só repuxa a mesma referência de imagem já declarada). Dois workflows, cada um com as `permissions` mínimas que a própria doc/action exige (o `GITHUB_TOKEN` nasce sem elas por padrão):
   - `.github/workflows/railway-config.yml` — job `plan`: `contents: read`, `pull-requests: write` (comentar o plano no PR), `actions: read` (baixar o artefato do plano); job `apply`: `contents: read`, `actions: read`, `pull-requests: read` (resolver qual PR mergeada gerou o plano aplicado).
   - `.github/workflows/deploy-staging.yml` — `contents: read`, `packages: write` (push pro GHCR) — mesmo bloco do exemplo oficial da Option 1.
   Alternativa (um workflow único fazendo tudo) descartada: as duas coisas têm gatilho e necessidade de review genuinamente diferentes, e a própria Railway documenta/distribui os dois fluxos separados.

8. **`sequelize.config.cjs` ganha um getter `staging`**, byte a byte igual ao `production` existente (lê `DATABASES`, mesmo tratamento de TLS/CA do Aiven) — nenhum caminho de código novo, só uma chave nova pra `--env staging` resolver em vez de estourar. `config.ts` não muda: a ramificação já é binária (`development` vs qualquer outro valor), então `NODE_ENV=staging` já cai no branch de `CONFIG`/`DATABASES` hoje.

## Risks / Trade-offs

- **[Tag mutável]** → um redeploy de `:staging` puxa o que estiver na tag naquele instante; duas execuções de CI em corrida (raro num fluxo de push único por branch, com concorrência nativa do GitHub por ref) poderiam aplicar o digest errado → Mitigação: `concurrency: group: deploy-staging` no workflow novo, pra enfileirar em vez de intercalar.
- **[Tag `sha-<hash>` sem consumidor automatizado]** → existe só como seguro manual de rollback (editar a imagem em `railway.ts` pra `:sha-<hash>` e reaplicar) → Mitigação: nenhuma agora; revisitar só se rollback manual virar dor real.
- **[`DATABASES` vazio ao criar o serviço]** → resolvido: `DATABASES` não depende de nenhum provisionamento novo, é referência (`${{oplab-radar-api.DATABASES}}`) a um valor que já existe e já é válido hoje. O que ainda pode faltar em `CONFIG`/`PLUGGY_CREDENTIAL_ENCRYPTION_KEY` (segredos próprios do `radar-pluggy`, sem equivalente a reaproveitar) continua exigindo a task 3.2 antes do serviço ficar saudável — `config.ts` recusa campo obrigatório ausente, por desenho, então o serviço fica crash-looping até esses dois existirem, não até um banco existir.
- **[`partial` ausente ou errado em `.railway/railway.ts`]** → `config apply` reconciliaria o projeto `oplab-radar` inteiro, podendo remover `oplab-radar-api`/`oplab-radar-front` (declarados em outro repositório, invisíveis a este arquivo) → Mitigação: `export const partial = "radar-pluggy"` é a primeira linha do arquivo, e o primeiro `config apply` (task 3.2) roda manualmente com `railway config plan` conferido antes — nunca aplicar sem revisar o plano. Esse risco ficou **mais grave** do que o design original previa: o ambiente-alvo não é mais um sandbox isolado, é o ambiente onde `oplab-radar-api`/`oplab-radar-front` já rodam em produção de verdade (ver Context) — um `partial` errado não afetaria só isolamento teórico, afetaria serviços com tráfego real hoje.
- **[`radar-pluggy` compartilha ambiente com serviços já em produção]** → qualquer variável `ctx.shared` (env var a nível de ambiente, não de serviço) declarada futuramente em `.railway/railway.ts` valeria pro ambiente inteiro, inclusive `oplab-radar-api`/`oplab-radar-front` → Mitigação: este arquivo só declara `env` dentro do `service("radar-pluggy", …)` (escopo de serviço), nunca `ctx.shared` — manter essa regra em qualquer evolução futura do arquivo.
- **[Pacote GHCR nasce privado]** → primeiro push num repo privado tende a criar o pacote como privado; sem alguém marcar como público, o pull do Railway falha por erro de autenticação → Mitigação: task explícita de checar/marcar visibilidade logo após o primeiro push, antes de depender do redeploy.
- **[IaC do Railway é recurso mais novo]** → menos testado que o `railway.json` clássico; a doc não deixava claro se bastava o arquivo pra rodar `config plan`/`apply` → Mitigação aplicada: `railway link` + `railway config plan` local (task 3.1) revelou que `railway/iac` é resolvido pelo pacote npm `railway` (SDK oficial, `railwayapp/railway-ts-sdk`) — sem ele instalado, tanto a CLI local quanto a action `railwayapp/config@v1` em CI falham com "TypeScript SDK is not installed". Adicionado como devDependency do projeto, e `.github/workflows/railway-config.yml` ganhou `actions/setup-node` + `npm ci` antes de cada chamada da action.

## Migration Plan

1. ~~Provisionar o banco Aiven de `staging`~~ — não precisa: reaproveita o banco físico do `oplab-radar-api` via referência de variável.
2. Adicionar o bloco `staging` em `sequelize.config.cjs`.
3. Escrever `.railway/railway.ts`; rodar `railway config plan`/`apply` manualmente uma vez (linkado ao ambiente `staging`) pra criar o serviço e confirmar a forma.
4. Cadastrar `RAILWAY_TOKEN` (project token escopado a `staging`) como secret do repositório.
5. Adicionar `.github/workflows/deploy-staging.yml` (build, push, redeploy) e `.github/workflows/railway-config.yml` (plan/apply futuro).
6. Primeiro push em `main`: confirmar publish da imagem, marcar pacote GHCR como público, confirmar que o redeploy do Railway puxa a imagem nova e o serviço sobe (healthcheck verde, migration aplicada).
7. Remover `railway.json`.

Rollback: reverter o commit de merge (remove os workflows novos e `.railway/railway.ts`, restaura `railway.json`); o serviço `staging` no Railway, se já criado, é removido manualmente via dashboard/MCP — nada neste desenho apaga recurso do Railway automaticamente a partir de um rollback de código.

## Open Questions

- Domínio do serviço `staging`: gerado automaticamente pelo Railway (`*.up.railway.app`) ou domínio customizado desde já? Não muda specs/abordagem/tasks (é um campo `domains` de uma linha em `railway.ts`, adicionável depois sem reestruturar) — decisão de quem rodar o primeiro `config apply`.
