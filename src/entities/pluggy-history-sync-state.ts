import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set(['itemId', 'lastCompletedItemUpdatedAt'])

export interface CreatePluggyHistorySyncStateProps {
  itemId: string
  lastCompletedItemUpdatedAt: Date
}

export class PluggyHistorySyncState {
  private constructor(
    private readonly itemId: string,
    private readonly lastCompletedItemUpdatedAt: Date,
  ) {}

  static create(props: CreatePluggyHistorySyncStateProps): PluggyHistorySyncState {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_HISTORY_SYNC_STATE_ITEM_ID_MISSING')

    if (
      props.lastCompletedItemUpdatedAt === undefined ||
      props.lastCompletedItemUpdatedAt === null ||
      Number.isNaN(props.lastCompletedItemUpdatedAt.getTime())
    ) {
      throw new ApplicationError('PLUGGY_HISTORY_SYNC_STATE_LAST_UPDATED_AT_MISSING', { itemId: props.itemId })
    }

    return new PluggyHistorySyncState(props.itemId, props.lastCompletedItemUpdatedAt)
  }

  static reconstitute(props: CreatePluggyHistorySyncStateProps): PluggyHistorySyncState {
    return new PluggyHistorySyncState(props.itemId, props.lastCompletedItemUpdatedAt)
  }

  getItemId(): string {
    return this.itemId
  }

  getLastCompletedItemUpdatedAt(): Date {
    return this.lastCompletedItemUpdatedAt
  }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_HISTORY_SYNC_STATE_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
