import { ApplicationError } from '../shared/application-error.js'

// Vocabulário fechado (design.md D24) — operação real que o SDK executa. Reserva `UPDATE_ITEM`/
// `REAL_TIME_BALANCE` para uso futuro sem migration nova.
export const PLUGGY_CALL_OPERATIONS = [
  'AUTH',
  'FETCH_ITEM',
  'FETCH_INVESTMENTS',
  'FETCH_INVESTMENT_TRANSACTIONS',
  'FETCH_LOANS',
  'FETCH_ACCOUNTS',
  'FETCH_ACCOUNT_TRANSACTIONS',
  'FETCH_CONSENTS',
  'FETCH_WEBHOOKS',
  'CREATE_WEBHOOK',
  'UPDATE_WEBHOOK',
  'UPDATE_ITEM',
  'REAL_TIME_BALANCE',
] as const
export type PluggyCallOperation = (typeof PLUGGY_CALL_OPERATIONS)[number]

export const PLUGGY_CALL_SCOPES = [
  'AUTH',
  'SNAPSHOT_READ',
  'PLATFORM_CONFIG',
  'ITEM_SYNC_TRIGGER',
  'DIRECT_INSTITUTION',
  'UNKNOWN',
] as const
export type PluggyCallScope = (typeof PLUGGY_CALL_SCOPES)[number]

// Vocabulário fechado de origem, compartilhado com pluggy-ingestion-coordination (design.md D23).
export const PLUGGY_CALL_TRIGGERS = [
  'CREDENTIAL_REGISTRATION_VALIDATION',
  'CREDENTIAL_REGISTRATION_PROVISIONING',
  'CREDENTIAL_REGISTRATION_PRELOAD',
  'WEBHOOK',
  'WEBHOOK_RECONCILIATION',
  'BOOT_RECOVERY',
  'MANUAL_HISTORY_LOAD',
  'USER_REFRESH',
  'REAL_TIME_BALANCE',
  'SYSTEM_INTERNAL',
] as const
export type PluggyCallTrigger = (typeof PLUGGY_CALL_TRIGGERS)[number]

export const PLUGGY_CALL_OUTCOMES = ['SUCCEEDED', 'FAILED'] as const
export type PluggyCallOutcome = (typeof PLUGGY_CALL_OUTCOMES)[number]

export const PLUGGY_CALL_FAILURE_KINDS = ['CLIENT_ERROR', 'UPSTREAM_ERROR', 'TIMEOUT', 'UNAVAILABLE', 'UNKNOWN'] as const
export type PluggyCallFailureKind = (typeof PLUGGY_CALL_FAILURE_KINDS)[number]

export interface CreatePluggyCallProps {
  itemId: string | undefined
  connectorId: number | undefined
  operation: string
  httpMethod: string | undefined
  routeTemplate: string | undefined
  callScope: string
  trigger: string
  resourceType: string | undefined
  resourceId: string | undefined
  requestCorrelationId: string
  webhookEventId: string | undefined
  pageOrdinal: number | undefined
  pageSize: number | undefined
  startedAt: Date
  completedAt: Date
  httpStatus: number | undefined
  outcome: string
  failureKind: string | undefined
  errorCode: string | undefined
}

// Um registro append-only de uma chamada real ao SDK da Pluggy (design.md D24, capability
// pluggy-call-history) — nunca atualizado depois de criado, nunca funciona como lock/lease/contador
// de quota. `durationMs` é sempre derivado de `startedAt`/`completedAt`, nunca recebido solto (evita
// os dois discordarem).
export class PluggyCall {
  private constructor(
    private readonly itemId: string | undefined,
    private readonly connectorId: number | undefined,
    private readonly operation: PluggyCallOperation,
    private readonly httpMethod: string | undefined,
    private readonly routeTemplate: string | undefined,
    private readonly callScope: PluggyCallScope,
    private readonly trigger: PluggyCallTrigger,
    private readonly resourceType: string | undefined,
    private readonly resourceId: string | undefined,
    private readonly requestCorrelationId: string,
    private readonly webhookEventId: string | undefined,
    private readonly pageOrdinal: number | undefined,
    private readonly pageSize: number | undefined,
    private readonly startedAt: Date,
    private readonly completedAt: Date,
    private readonly httpStatus: number | undefined,
    private readonly outcome: PluggyCallOutcome,
    private readonly failureKind: PluggyCallFailureKind | undefined,
    private readonly errorCode: string | undefined,
  ) {}

  static create(props: CreatePluggyCallProps): PluggyCall {
    assertPresent(props.requestCorrelationId, 'PLUGGY_CALL_REQUEST_CORRELATION_ID_MISSING')
    assertOneOf(props.operation, PLUGGY_CALL_OPERATIONS, 'PLUGGY_CALL_OPERATION_UNKNOWN')
    assertOneOf(props.callScope, PLUGGY_CALL_SCOPES, 'PLUGGY_CALL_SCOPE_UNKNOWN')
    assertOneOf(props.trigger, PLUGGY_CALL_TRIGGERS, 'PLUGGY_CALL_TRIGGER_UNKNOWN')
    assertOneOf(props.outcome, PLUGGY_CALL_OUTCOMES, 'PLUGGY_CALL_OUTCOME_UNKNOWN')

    if (props.startedAt === undefined || Number.isNaN(props.startedAt.getTime())) {
      throw new ApplicationError('PLUGGY_CALL_STARTED_AT_MISSING')
    }
    if (props.completedAt === undefined || Number.isNaN(props.completedAt.getTime())) {
      throw new ApplicationError('PLUGGY_CALL_COMPLETED_AT_MISSING')
    }

    // failure_kind só existe junto de outcome FAILED — os dois sempre andam juntos (design.md D24).
    if (props.outcome === 'FAILED') {
      assertOneOf(props.failureKind, PLUGGY_CALL_FAILURE_KINDS, 'PLUGGY_CALL_FAILURE_KIND_MISSING')
    } else if (props.failureKind !== undefined) {
      throw new ApplicationError('PLUGGY_CALL_FAILURE_KIND_ON_SUCCESS', { failureKind: props.failureKind })
    }

    return new PluggyCall(
      props.itemId,
      props.connectorId,
      props.operation as PluggyCallOperation,
      props.httpMethod,
      props.routeTemplate,
      props.callScope as PluggyCallScope,
      props.trigger as PluggyCallTrigger,
      props.resourceType,
      props.resourceId,
      props.requestCorrelationId,
      props.webhookEventId,
      props.pageOrdinal,
      props.pageSize,
      props.startedAt,
      props.completedAt,
      props.httpStatus,
      props.outcome as PluggyCallOutcome,
      props.failureKind as PluggyCallFailureKind | undefined,
      props.errorCode,
    )
  }

  getItemId(): string | undefined { return this.itemId }
  getConnectorId(): number | undefined { return this.connectorId }
  getOperation(): PluggyCallOperation { return this.operation }
  getHttpMethod(): string | undefined { return this.httpMethod }
  getRouteTemplate(): string | undefined { return this.routeTemplate }
  getCallScope(): PluggyCallScope { return this.callScope }
  getTrigger(): PluggyCallTrigger { return this.trigger }
  getResourceType(): string | undefined { return this.resourceType }
  getResourceId(): string | undefined { return this.resourceId }
  getRequestCorrelationId(): string { return this.requestCorrelationId }
  getWebhookEventId(): string | undefined { return this.webhookEventId }
  getPageOrdinal(): number | undefined { return this.pageOrdinal }
  getPageSize(): number | undefined { return this.pageSize }
  getStartedAt(): Date { return this.startedAt }
  getCompletedAt(): Date { return this.completedAt }
  getDurationMs(): number { return this.completedAt.getTime() - this.startedAt.getTime() }
  getHttpStatus(): number | undefined { return this.httpStatus }
  getOutcome(): PluggyCallOutcome { return this.outcome }
  getFailureKind(): PluggyCallFailureKind | undefined { return this.failureKind }
  getErrorCode(): string | undefined { return this.errorCode }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertOneOf<T extends string>(value: string | undefined, allowed: readonly T[], errorType: string): asserts value is T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new ApplicationError(errorType, { value })
  }
}
