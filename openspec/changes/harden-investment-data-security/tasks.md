## 1. Fechar a fronteira HTTP

- [x] 1.1 Publicar a porta local somente em loopback ou rede privada configurada; verificar acesso do proxy e ausência de escuta em `0.0.0.0` no host.
- [x] 1.2 Adicionar `Cache-Control: no-store` às respostas privadas diretas e CORS fechado por padrão; verificar preflight externo, origem `null` e eventual origem exata configurada.
- [x] 1.3 Rever avisos de `sequelize`/`uuid` e aplicar somente atualização compatível; verificar testes e `npm audit --omit=dev` com risco residual documentado.

## 2. Validar a sessão central

- [x] 2.1 Integrar introspecção privada da API nas rotas de usuário, com credencial de serviço, timeout e falha fechada; verificar sessão ativa, expirada, revogada e API indisponível.
- [x] 2.2 Resolver pessoa somente da sessão validada no cadastro de credencial e demais rotas; verificar que `personId` informado pelo cliente não muda o titular.
- [x] 2.3 Aplicar origem e CSRF às mutações por cookie, sem alterar autenticação por segredo do webhook; verificar mutação sem token recusada e webhook sem segredo recusado mesmo com cookie.
- [ ] 2.4 Executar matriz de credenciais, contas, posições e transações com duas pessoas e IDs cruzados; corrigir vazamentos reproduzidos e verificar ausência de dados da outra pessoa.

## 3. Coordenar a publicação

- [ ] 3.1 Durante janela dual limitada, testar cliente antigo e novo com API/frontend e registrar uso residual de Bearer sem registrar tokens.
- [ ] 3.2 Após migração do frontend, remover aceitação de JWT e chave HMAC compartilhada das rotas de usuário em sincronia com a API; verificar Bearer antigo recusado e logout opaco imediato.
- [ ] 3.3 Executar teste local completo de proxy, login, Pluggy, revogação, CSRF e webhook e registrar o procedimento de rollback que exige novo login.
