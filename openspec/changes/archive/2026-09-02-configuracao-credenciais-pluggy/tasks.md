## 1. Modelo de dados (`pluggy_credentials`)

- [x] 1.1 Implementar o helper de cifragem/decifragem AES-256-GCM (design.md D6), lendo a chave de
      `PLUGGY_CREDENTIAL_ENCRYPTION_KEY` — recusa nomeada se a variável estiver ausente. Teste cobrindo
      round-trip (cifra → decifra) e ausência da chave. (`src/shared/pluggy-credential-cipher.ts`)
- [x] 1.2 Criar migration `pluggy_credentials`: `id`, `person_id` (`BIGINT.UNSIGNED`, sem FK de saída — mesmo
      padrão de `pluggy_items` para `people`), `client_id`, `client_secret` (cifrado, D6), `created_at`,
      `updated_at`. Constraint de unicidade que impeça duplicar a mesma credencial para a mesma pessoa.
      Verificar migrate e rollback (`db:migrate` / `db:migrate:undo`) sem erro. (verificado: migrate e undo
      limpos)
- [x] 1.3 Criar migration `pluggy_credential_items`: vincula cada `item_id` a uma `pluggy_credentials.id` —
      implementa design.md D5 (itemId resolve a uma única credencial). Índice único em `item_id`. (verificado:
      migrate e undo limpos)
- [x] 1.4 Criar entity `PluggyCredential` (factory `create`, `reconstitute`) com as mesmas invariantes de
      `PluggyItem`: `personId` obrigatório, sem campo inesperado aceito. Teste unitário cobrindo criação sem
      `personId` e campo de credencial duplicado sendo aceito (uma pessoa, mais de uma credencial).
      (`src/entities/pluggy-credential.ts`)
- [x] 1.5 Criar model Sequelize + repositório (`PluggyCredentialRep`), espelhando o padrão de
      `pluggy-item-model.ts`/`pluggy-item.rep.ts`, com teste de contrato mirando a migration.
      (`src/infra/db/models/pluggy-credential-model.ts`,
      `src/adapters/repositories/pluggy-credential.rep.ts` — client_secret cifrado confirmado por teste)

## 2. Resolução itemId → credencial

- [x] 2.1 Implementar a busca `itemId` → `PluggyCredential`, usando o vínculo da tarefa 1.3 — teste cobrindo
      `itemId` sem credencial associada, recusa nomeando o `itemId` (spec `pluggy-credentials`).
      (`src/interactors/pluggy-credential/find/find-pluggy-credential.interactor.ts`,
      `src/adapters/repositories/pluggy-credential-item.rep.ts`)
- [x] 2.2 Implementar a recusa nomeada para pessoa sem nenhuma credencial cadastrada e para pessoa com
      credencial mas sem `itemId` associado — teste cobrindo os dois cenários do spec `pluggy-credentials`.
      (`src/interactors/pluggy-credential/check/check-pluggy-credential.interactor.ts`)

## 3. Cliente HTTP de autenticação

- [x] 3.1 Implementar `POST /auth` (`clientId`/`clientSecret` → `apiKey`) com timeout e tratamento de erro —
      teste cobrindo sucesso, credencial inválida (401) e timeout. Não inclui chamadas de dado
      (`GET /investments` etc.) — fora do escopo deste change. (`src/adapters/gateways/pluggy-auth.gateway.ts`)
- [x] 3.2 Garantir que o `apiKey` nunca é logado e não é persistido além do cache em memória necessário para a
      chamada — verificado por leitura do código: `PluggyAuthGateway` não loga nada e não persiste o `apiKey`,
      só devolve ao chamador. Sem cache nesta tarefa (não há consumidor repetido ainda — fica para o change que
      adicionar a chamada de dado).

## 4. Endpoint de escrita da credencial

- [x] 4.1 Criar handler HTTP para cadastrar credencial + itemId de uma pessoa, seguindo a fronteira de erro do
      handler (`padroes-de-engenharia`, D-J) — teste de rota cobrindo sucesso e campo obrigatório ausente.
      (`src/adapters/handlers/register-pluggy-credential.handler.ts` — testado como função, sem servidor HTTP
      real de pé; ver ressalva abaixo)
- [x] 4.3 Bootstrap do Express (`src/infra/http-server.ts`), registrando `POST /credentials` com
      `express.json()` — teste sobe a aplicação numa porta efêmera e faz requisição HTTP real (sucesso e campo
      ausente), provando que a rota é alcançável de ponta a ponta.
- [x] 4.4 Corrigir o contrato de erro: o handler respondia `{errorType, details}`, mas
      `oplab-radar-front` (`http-client.ts`, `toApiError`) já lê `{errorType, extras}` de todo endpoint —
      achado ao integrar com o front de verdade (tarefa 5). Corrigido pra `extras`, testes atualizados.
- [x] 4.5 Primeiro entrypoint real do serviço (`src/index.ts`): monta as dependências reais
      (`PluggyCredentialRep`/`PluggyCredentialItemRep` com conexão Sequelize real) e chama `app.listen`.
      Scripts `build`/`start` no `package.json`. Verificado manualmente: builda, sobe na porta configurada
      por `PORT` (default 3003), responde 400 real a um `POST /credentials` sem corpo — mesmo com o MySQL
      local fora do ar no momento do teste (a conexão é só usada na primeira query, não na inicialização).

- [x] 4.6 Achado de segurança ao integrar com o front de verdade (D8, design.md): `POST /credentials` não
      autenticava nada — confiava no `personId` do corpo. Corrigido com middleware de autenticação
      (`src/infra/authenticate.middleware.ts`) reimplementando a verificação do JWT hand-rolled do
      `oplab-radar-api` (`src/shared/jwt-verifier.ts`), resolvendo `personId` por `username` via leitura
      read-only de `people` (`src/infra/db/models/person-model.ts`,
      `src/adapters/repositories/person.rep.ts`). `personId` não existe mais no corpo da requisição — só em
      `req.personId`, resolvido pelo middleware. Segredo combinado por `JWT_SECRET` (mesmo valor de
      `config.http.jwtSecret` no `oplab-radar-api`). Testes: 5 do verificador de JWT, 5 do middleware, 2 novos
      de ponta a ponta no `http-server.ts` (sem token → 401; com token válido → 201).
- [x] 4.7 Três achados do `engenheiro-pluggy-connector` na revisão de 4.6, todos corrigidos: (1) branch de
      erro inesperado do middleware (`people.findIdByUsername` falhando) sem teste — adicionado; (2)
      `errorType: 'AUTHENTICATION_FAILED'` sem namespace, quebrando a convenção do resto do arquivo —
      renomeado pra `PLUGGY_CONNECTOR_AUTHENTICATION_FAILED`; (3) JSON malformado no corpo escapava de
      `express.json()` direto pro handler de erro padrão do Express, vazando stack trace com caminho
      absoluto do servidor em HTML — corrigido com middleware de erro de 4 parâmetros ao final de
      `createHttpServer`, respondendo `{errorType: 'PLUGGY_CONNECTOR_MALFORMED_JSON'}`. Teste de regressão
      batendo com corpo JSON inválido de verdade, confirmando ausência de stack trace no corpo da resposta.
      79/79 testes que não dependem de banco passando. Segunda rodada do `engenheiro-pluggy-connector`:
      **Aprovado**.
- [x] 4.8 Achado residual (fora dos 3 bloqueantes, sinalizado pelos dois revisores): `personId` tipado como
      `number | undefined` no interactor, mesmo sempre chegando definido do middleware. Corrigido —
      `RegisterPluggyCredentialInput`/`CreatesPluggyCredential.create` agora exigem `personId: number`; o
      handler ganhou uma recusa nomeada (`PLUGGY_CONNECTOR_UNEXPECTED_ERROR`) para o caso (que não deveria
      acontecer) de `req.personId` vir `undefined`, em vez de deixar passar. 80/80 testes que não dependem de
      banco.
- [x] 4.9 Banco local voltou ao ar. Reverificação completa: 104 testes que dependiam de banco rodaram e
      passaram (repositório/contrato de `pluggy_credentials`, `pluggy_credential_items`, `pluggy_items`,
      `pluggy_positions`). Achado ao reverificar: `PersonRep`/`person-model.ts` (tarefa 4.6) nunca tinham
      teste — corrigido com `tests/infra/db/models/person-model.contract.test.ts` (confere só as colunas que
      este serviço declara, nunca o schema inteiro de `people` — não é dono) e
      `tests/adapters/repositories/person.rep.test.ts` (lê uma linha real existente, sem hardcodar username,
      nunca escreve em `people`). 107/107 testes totais. Verificação manual de ponta a ponta com o serviço
      real rodando (`npm run build` + `node dist/src/index.js`) contra o banco real: 401 sem token, 201 com
      JWT válido assinado pro username real de uma pessoa existente, linha gravada em `pluggy_credentials` e
      `pluggy_credential_items` — removida manualmente depois (dado de teste, não do titular).

## 5. Conectividade e tela de configurações (`oplab-radar-front`, repositório separado)

- [x] 5.1 Configurar rota nova no proxy do `oplab-radar-front` (design.md D7, `/api/pluggy`, `vite.config.ts`)
      apontando para este serviço (porta 3003, configurável por `PLUGGY_CONNECTOR_PROXY_TARGET`), em paralelo
      à rota existente para `oplab-radar-api`.
- [x] 5.2 Menu de usuário novo (`UserMenu.vue`, avatar com a inicial do username no topo da topbar, painel
      não-modal que fecha em clique fora/Esc) com item "Configurações" → `SettingsView.vue`
      (rota `/configuracoes`, eyebrow "Conta"), formulário pra `clientId`/`clientSecret`/`itemId` consumindo
      o endpoint via `pluggy-credentials.api.ts`/`pluggy-credentials.store.ts`. "Sair" migrou pra dentro do
      menu (antes solto na topbar). Sem gate nas outras rotas — não fazia parte do pedido. 8 testes novos
      (api, store, componente do menu, view), 200/200 testes do front, lint e type-check limpos.
      **Bloqueio conhecido:** verificação manual no navegador não foi feita — MySQL local indisponível durante
      esta tarefa impede login de ponta a ponta (autenticação depende de `people`, tabela do `oplab-radar-api`).
      Cobertura automatizada existe; falta o passo visual quando o banco voltar.

## 6. Verificação

- [x] 6.1 Rodar lint, verificação de tipos e teste na íntegra, e registrar o resultado. (54/54 testes, lint e
      type-check limpos — MySQL real via `shared-services-mysql-1`, mesma infraestrutura do CI)
- [x] 6.2 Acionar `arquiteto-pluggy-connector` e `engenheiro-pluggy-connector`, fornecendo diff, arquivos e
      resultado das verificações. (duas rodadas: "Ajustar" com achados bloqueantes nos dois — orquestração fora
      do interactor, `getId()`/cast em 8 pontos, validação duplicada no handler, entidade sem comportamento
      próprio, gap documental em `fronteira-pluggy` regra 13 — todos corrigidos; terceira rodada só do
      `engenheiro-pluggy-connector` fechou o achado residual em `CheckPluggyCredentialInteractor` (então
      `EnsurePersonHasSyncablePluggyCredential`, renomeado depois — ver 6.3). Veredito final dos dois:
      **Aprovado**)
- [x] 6.3 Reorganizar `interactors/` para a convenção de nome documentada em `arquitetura-camadas` (pasta por
      objeto, subpasta por ação, `<ação>-<objeto>.interactor.ts` + `.types.ts`, classe
      `<Ação><Objeto>Interactor`) — inspirada em `interactors/car/` do `oplab-radar-api`, só nomenclatura, não o
      desenho interno daquele fluxo. `RegisterPluggyCredential` → `RegisterPluggyCredentialInteractor`,
      `ResolvePluggyCredentialForItem` → `FindPluggyCredentialInteractor`,
      `EnsurePersonHasSyncablePluggyCredential` → `CheckPluggyCredentialInteractor`. 54/54 testes, lint e
      type-check limpos após a reorganização.
