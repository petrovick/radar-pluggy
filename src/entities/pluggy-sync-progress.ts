import { ApplicationError } from '../shared/application-error.js'
import { PLUGGY_SOURCES, type PluggySource } from '../adapters/gateways/pluggy-source-catalog.js'

// Pipeline que processa a fonte — nomeado pelo próprio interactor consumidor, para não inventar um
// terceiro vocabulário (design.md D4).
export const PLUGGY_SYNC_CONSUMERS = ['POSITION_SYNC', 'HISTORY_LOAD'] as const
export type PluggySyncConsumer = (typeof PLUGGY_SYNC_CONSUMERS)[number]

const ALLOWED_CREATE_FIELDS = new Set(['itemId', 'consumer', 'source', 'lastCompletedVersionAt'])

export interface CreatePluggySyncProgressProps {
  itemId: string
  consumer: string
  source: string
  lastCompletedVersionAt: Date
}

// Marca d'água por (`itemId`, `consumer`, `source`) — design.md D4/D12: "até qual versão da execução
// este consumidor processou com sucesso para esta fonte", nunca "qual versão desta fonte existe na
// Pluggy". `INVESTMENTS` é acompanhada pelos dois consumidores; cada linha é independente.
export class PluggySyncProgress {
  private constructor(
    private readonly itemId: string,
    private readonly consumer: PluggySyncConsumer,
    private readonly source: PluggySource,
    private lastCompletedVersionAt: Date,
  ) {}

  static create(props: CreatePluggySyncProgressProps): PluggySyncProgress {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_SYNC_PROGRESS_ITEM_ID_MISSING')
    assertValidConsumer(props.consumer)
    assertValidSource(props.source)

    if (props.lastCompletedVersionAt === undefined || Number.isNaN(props.lastCompletedVersionAt.getTime())) {
      throw new ApplicationError('PLUGGY_SYNC_PROGRESS_VERSION_MISSING', { itemId: props.itemId })
    }

    return new PluggySyncProgress(props.itemId, props.consumer, props.source, props.lastCompletedVersionAt)
  }

  static reconstitute(props: CreatePluggySyncProgressProps): PluggySyncProgress {
    assertValidConsumer(props.consumer)
    assertValidSource(props.source)
    return new PluggySyncProgress(props.itemId, props.consumer, props.source, props.lastCompletedVersionAt)
  }

  // Avanço sem regressão (mesma forma de `PluggyItem.advanceWatermark`): igual ou mais novo aplica,
  // mais antigo lança — usado para o invariante em memória; a escrita real no banco (design.md D17)
  // é atômica, feita pelo repositório, e não depende deste método para estar correta.
  advance(versionAt: Date): void {
    if (versionAt.getTime() < this.lastCompletedVersionAt.getTime()) {
      throw new ApplicationError('PLUGGY_SYNC_PROGRESS_REGRESSION', {
        itemId: this.itemId,
        consumer: this.consumer,
        source: this.source,
        current: this.lastCompletedVersionAt,
        attempted: versionAt,
      })
    }
    this.lastCompletedVersionAt = versionAt
  }

  getItemId(): string {
    return this.itemId
  }

  getConsumer(): PluggySyncConsumer {
    return this.consumer
  }

  getSource(): PluggySource {
    return this.source
  }

  getLastCompletedVersionAt(): Date {
    return this.lastCompletedVersionAt
  }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertValidConsumer(value: string): asserts value is PluggySyncConsumer {
  if (!(PLUGGY_SYNC_CONSUMERS as readonly string[]).includes(value)) {
    throw new ApplicationError('PLUGGY_SYNC_PROGRESS_CONSUMER_UNKNOWN', { consumer: value })
  }
}

function assertValidSource(value: string): asserts value is PluggySource {
  if (!(PLUGGY_SOURCES as readonly string[]).includes(value)) {
    throw new ApplicationError('PLUGGY_SYNC_PROGRESS_SOURCE_UNKNOWN', { source: value })
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_SYNC_PROGRESS_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
