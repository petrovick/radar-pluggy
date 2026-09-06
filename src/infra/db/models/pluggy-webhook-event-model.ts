import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/20260903180000-criar-pluggy-connector-webhook-events.cjs — ver
// teste de contrato em tests/infra/db/models/pluggy-webhook-event-model.contract.test.ts.
export interface PluggyWebhookEventRow {
  id: number
  event_id: string
  item_id: string
  event: string
  state: string
  lease_until: Date | null
  attempts: number
  last_attempt_at: Date | null
  error_summary: string | null
  created_at: Date
  updated_at: Date
}

export function definePluggyWebhookEventModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyWebhookEventRow>>(
    'PluggyWebhookEvent',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      event_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      event: { type: DataTypes.STRING(50), allowNull: false },
      state: { type: DataTypes.STRING(20), allowNull: false },
      lease_until: { type: DataTypes.DATE(3), allowNull: true },
      attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      last_attempt_at: { type: DataTypes.DATE(3), allowNull: true },
      error_summary: { type: DataTypes.STRING(500), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_webhook_events',
      timestamps: false,
    },
  )
}
