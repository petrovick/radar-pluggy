// Vocabulário fechado de conexão exposto ao produto (capability pluggy-connection-observability).
// Todo valor de `status` documentado pela Pluggy tem uma tradução definida — nenhum cai em erro por
// falta de mapeamento.
export const PLUGGY_CONNECTION_STATUSES = [
  'CONNECTING',
  'CONNECTED',
  'PARTIAL',
  'NEEDS_RECONNECT',
  'AWAITING_USER_INPUT',
  'STALE',
  'DISCONNECTED',
  'UNKNOWN',
] as const
export type PluggyConnectionStatus = (typeof PLUGGY_CONNECTION_STATUSES)[number]

export interface ConnectionStatusInput {
  // Presente é o vínculo credencial↔item marcado inativo (`item/deleted`, design.md D28/D29).
  inactiveAt: Date | undefined
  // `undefined` é "nenhuma observação registrada ainda" (item recém-vinculado) — nunca `CONNECTED`
  // por omissão.
  status: string | undefined
  executionStatus: string | undefined
}

// `DISCONNECTED` nunca vem de `(status, executionStatus)` — vem exclusivamente de `inactiveAt`
// presente, e essa checagem precede qualquer tradução do par (design.md D28/D29).
export function toConnectionStatus(input: ConnectionStatusInput): PluggyConnectionStatus {
  if (input.inactiveAt !== undefined) {
    return 'DISCONNECTED'
  }
  if (input.status === undefined) {
    return 'UNKNOWN'
  }

  switch (input.status) {
    case 'LOGIN_ERROR':
      return 'NEEDS_RECONNECT'
    case 'WAITING_USER_INPUT':
    case 'WAITING_USER_ACTION':
      return 'AWAITING_USER_INPUT'
    case 'UPDATING':
    case 'MERGING':
      return 'CONNECTING'
    case 'OUTDATED':
      return 'STALE'
    case 'UPDATED':
      return input.executionStatus === 'PARTIAL_SUCCESS' ? 'PARTIAL' : 'CONNECTED'
    default:
      return 'UNKNOWN'
  }
}
