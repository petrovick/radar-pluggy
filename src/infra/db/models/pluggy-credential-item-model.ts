import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/<...>-criar-pluggy-credential-items.cjs — ver teste de contrato
// em tests/infra/db/models/pluggy-credential-item-model.contract.test.ts. Vincula um itemId à
// credencial que o autenticou (design.md D5, configuracao-credenciais-pluggy).
export interface PluggyCredentialItemRow {
  id: number
  credential_id: number
  item_id: string
  created_at: Date
  updated_at: Date
}

export function definePluggyCredentialItemModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyCredentialItemRow>>(
    'PluggyCredentialItem',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      credential_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      item_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_credential_items',
      timestamps: false,
    },
  )
}
