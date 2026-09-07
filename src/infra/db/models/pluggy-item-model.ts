import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/<...>-criar-pluggy-items.cjs — ver teste de contrato em
// tests/adapters/repositories/pluggy-item-model.contract.test.ts. Atributos ficam em snake_case,
// iguais à coluna: a tradução para camelCase acontece só no repositório (modelagem-de-dados).
export interface PluggyItemRow {
  id: number
  item_id: string
  person_id: number
  status: string
  execution_status: string | null
  last_updated_at: Date | null
  created_at: Date
  updated_at: Date
}

export function definePluggyItemModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyItemRow>>(
    'PluggyItem',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      person_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      status: { type: DataTypes.STRING(20), allowNull: false },
      execution_status: { type: DataTypes.STRING(50), allowNull: true },
      last_updated_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_items',
      timestamps: false,
    },
  )
}
