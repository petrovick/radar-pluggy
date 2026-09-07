import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha `radar_pluggy_item_ingestion_leases` (design.md D16): no máximo uma ingestão
// (Position+History) por Item por vez, qualquer que seja o trigger. `fencing_token` — contador
// monotônico, nunca timestamp — é a prova de posse.
export interface PluggyItemIngestionLeaseRow {
  id: number
  item_id: string
  trigger: string
  lease_until: Date
  fencing_token: number
  acquired_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyItemIngestionLeaseModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyItemIngestionLeaseRow>>(
    'PluggyItemIngestionLease',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      trigger: { type: DataTypes.STRING(50), allowNull: false },
      lease_until: { type: DataTypes.DATE(3), allowNull: false },
      fencing_token: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      acquired_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_item_ingestion_leases',
      timestamps: false,
    },
  )
}
