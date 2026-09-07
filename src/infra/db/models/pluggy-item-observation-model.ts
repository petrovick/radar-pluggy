import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha `radar_pluggy_item_observations` (design.md D33).
export interface PluggyItemObservationRow {
  id: number
  item_id: string
  status: string
  execution_status: string
  status_detail: Record<string, unknown> | null
  item_products: string[] | null
  last_updated_at: Date | null
  next_auto_sync_at: Date | null
  connector_id: number | null
  observation_started_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyItemObservationModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyItemObservationRow>>(
    'PluggyItemObservation',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      status: { type: DataTypes.STRING(30), allowNull: false },
      execution_status: { type: DataTypes.STRING(30), allowNull: false },
      status_detail: { type: DataTypes.JSON, allowNull: true },
      item_products: { type: DataTypes.JSON, allowNull: true },
      last_updated_at: { type: DataTypes.DATE(3), allowNull: true },
      next_auto_sync_at: { type: DataTypes.DATE(3), allowNull: true },
      connector_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      observation_started_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_item_observations',
      timestamps: false,
    },
  )
}
