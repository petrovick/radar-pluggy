// Contrato mínimo, sem dependência de infra, pra um caso de uso recusar NOVO trabalho quando o
// lease de ingestão que o protege foi perdido (heartbeat com `renew() === false`) — invariante
// exigido para esta implementação: nenhuma página nova, chamada nova ou commit destrutivo novo
// pode começar depois da perda detectada, mesmo que o trabalho em voo termine.
//
// Quem já iniciou uma chamada antes da perda ser detectada não é abortado no meio: a proteção
// contra regressão de versão (marca d'água + `UPDATE ... WHERE`) garante que o resultado dela nunca
// sobrescreve uma fotografia mais nova. Este guard é uma camada extra, verificada nos pontos onde o
// caso de uso decide começar mais trabalho.
export interface LeaseGuard {
  isLost(): boolean
}
