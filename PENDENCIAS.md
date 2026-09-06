# Pendências para publicar o radar-pluggy

Duas pendências restantes, as duas cross-repo — fora do escopo deste repositório sozinho.

- [ ] **1.** Nenhuma tabela `radar_pluggy_*` é lida pelo `oplab-radar-api` (confirmado por grep
      completo nos dois repositórios: zero ocorrência de qualquer uma das 11 tabelas). Decidido:
      publicar mesmo assim, como coletor — dado de Open Finance não retroage, e o consumidor é
      tarefa própria do `oplab-radar-api`, PR separado.
- [ ] **2.** O `oplab-radar-api` já tem receptor próprio de webhook Pluggy
      (`src/infra/http/routes/webhook.routes.ts:27`, tabela `pluggy_webhooks`, **só grava** — sem
      fila, sem dreno, sem reprocessamento; `processed_at` nunca é escrito por nenhuma linha de
      código). A URL registrada na Pluggy hoje aponta pra lá
      (`https://api.exemplo.com/api/webhooks/pluggy`, com entregas reais em produção, ADR
      0030). Decidido: o connector assume — ele tem inbox durável, lease, dreno e segredo por
      credencial; a API só grava numa tabela que ninguém lê. É o corte que `fronteira-pluggy` regra
      13 já antecipa ("após o corte do webhook, `pluggy_webhooks` passa a ser tabela deste
      serviço"). Falta: repontar a URL na Pluggy, PR no `oplab-radar-api` removendo a rota, e
      decidir o destino da tabela `pluggy_webhooks` antiga. Decisão do usuário: aguardar o momento
      certo, não fazer ainda.
