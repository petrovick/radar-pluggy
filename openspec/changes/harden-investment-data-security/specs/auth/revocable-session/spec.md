## Purpose

Faz o serviço Pluggy reconhecer somente sessões de usuário ativas e revogáveis, preservando o isolamento de dados por pessoa.

## ADDED Requirements

### Requirement: Validação da sessão ativa
O serviço MUST validar a sessão de usuário pela autoridade de sessão da API e resolver a pessoa a partir do resultado validado. Uma sessão ausente, expirada ou revogada MUST ser recusada genericamente; JWT assinado com chave compartilhada MUST NOT autenticar rotas de usuário após a migração.

#### Scenario: Sessão revogada
- **WHEN** a API revoga uma sessão e o navegador consulta posições Pluggy
- **THEN** o serviço recusa a consulta sem retornar dados financeiros

### Requirement: Isolamento por pessoa
O serviço MUST limitar cada leitura e mutação de credenciais, contas, posições e transações à pessoa resolvida da sessão.

#### Scenario: Identificador de item de outra pessoa
- **WHEN** a pessoa A fornece o identificador de um item pertencente à pessoa B
- **THEN** o serviço não revela nem altera os dados de B
