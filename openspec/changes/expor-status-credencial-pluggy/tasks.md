## 1. Endpoint

- [ ] 1.1 Criar `src/adapters/handlers/check-pluggy-credential.handler.ts`, seguindo o padrão de
      `register-pluggy-credential.handler.ts`: `personId`/`container` resolvidos do escopo
      por-request; erro nomeado do interactor (ambos os cenários) vira `200 {hasCredential:false}`;
      sucesso vira `200 {hasCredential:true}`; falha inesperada vira
      `500 {errorType:'PLUGGY_CREDENTIAL_STATUS_CHECK_FAILED'}`.
- [ ] 1.2 Registrar `app.get('/credentials/status', authenticate, checkPluggyCredentialHandler)` em
      `src/infra/http/http-server.ts`.
- [ ] 1.3 Atualizar o comentário de
      `src/interactors/pluggy-credential/check/check-pluggy-credential.interactor.ts` — não é mais
      "sem rota, de propósito"; manter a explicação de por que o sucesso continua `data: {}`.
- [ ] 1.4 Teste unitário do handler (`tests/adapters/handlers/check-pluggy-credential.handler.test.ts`,
      mesmo formato de `register-pluggy-credential.handler.test.ts`): sucesso, os dois errorTypes de
      "não configurado", `personId` ausente, falha de resolução do container.
- [ ] 1.5 Teste de integração em `tests/infra/http/http-server.test.ts`, estendendo o
      `fakeContainer` com `checkPluggyCredentialInteractor`: sem token → 401; com token e sem
      credencial → `hasCredential:false`; com token e credencial completa → `hasCredential:true`.

## 2. Verificação

- [ ] 2.1 Rodar `npm run lint`, `npm run type-check`, `npm test` e registrar o resultado.
