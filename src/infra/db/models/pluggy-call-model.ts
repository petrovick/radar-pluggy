import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha `radar_pluggy_calls` (design.md D24) — append-only, sem `updated_at`.
export interface PluggyCallRow {
  id: number
  item_id: string | null
  connector_id: number | null
  operation: string
  http_method: string | null
  route_template: string | null
  call_scope: string
  trigger: string
  resource_type: string | null
  resource_id: string | null
  request_correlation_id: string
  webhook_event_id: string | null
  page_ordinal: number | null
  page_size: number | null
  started_at: Date
  completed_at: Date
  duration_ms: number
  http_status: number | null
  outcome: string
  failure_kind: string | null
  error_code: string | null
  created_at: Date
}

export function definePluggyCallModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyCallRow>>(
    'PluggyCall',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: true },
      connector_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      operation: { type: DataTypes.STRING(50), allowNull: false },
      http_method: { type: DataTypes.STRING(10), allowNull: true },
      route_template: { type: DataTypes.STRING(100), allowNull: true },
      call_scope: { type: DataTypes.STRING(30), allowNull: false },
      trigger: { type: DataTypes.STRING(50), allowNull: false },
      resource_type: { type: DataTypes.STRING(30), allowNull: true },
      resource_id: { type: DataTypes.STRING(64), allowNull: true },
      request_correlation_id: { type: DataTypes.STRING(36), allowNull: false },
      webhook_event_id: { type: DataTypes.STRING(64), allowNull: true },
      page_ordinal: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      page_size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      started_at: { type: DataTypes.DATE(3), allowNull: false },
      completed_at: { type: DataTypes.DATE(3), allowNull: false },
      duration_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      http_status: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      outcome: { type: DataTypes.STRING(20), allowNull: false },
      failure_kind: { type: DataTypes.STRING(30), allowNull: true },
      error_code: { type: DataTypes.STRING(100), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_calls',
      timestamps: false,
    },
  )
}
