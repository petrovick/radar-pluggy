import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha `radar_pluggy_sync_progress` (design.md D4/D12) — sucede `radar_pluggy_history_sync_states`.
export interface PluggySyncProgressRow {
  id: number
  item_id: string
  consumer: string
  source: string
  last_completed_version_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggySyncProgressModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggySyncProgressRow>>(
    'PluggySyncProgress',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      consumer: { type: DataTypes.STRING(30), allowNull: false },
      source: { type: DataTypes.STRING(30), allowNull: false },
      last_completed_version_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_sync_progress',
      timestamps: false,
    },
  )
}
