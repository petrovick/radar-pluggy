import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyHistorySyncStateRow {
  id: number
  item_id: string
  last_completed_item_updated_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyHistorySyncStateModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyHistorySyncStateRow>>(
    'PluggyHistorySyncState',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      last_completed_item_updated_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_history_sync_states',
      timestamps: false,
    },
  )
}
