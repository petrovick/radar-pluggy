import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/20260904190000-criar-pluggy-connector-consents.cjs — ver teste
// de contrato em tests/infra/db/models/pluggy-consent-model.contract.test.ts.
export interface PluggyConsentRow {
  id: number
  item_id: string
  consent_id: string
  granted_at: Date
  expires_at: Date | null
  revoked_at: Date | null
  products: string[] | null
  open_finance_permissions_granted: string[] | null
  created_at: Date
  updated_at: Date
}

export function definePluggyConsentModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyConsentRow>>(
    'PluggyConsent',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      consent_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      granted_at: { type: DataTypes.DATE(3), allowNull: false },
      expires_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_at: { type: DataTypes.DATE(3), allowNull: true },
      products: { type: DataTypes.JSON, allowNull: true },
      open_finance_permissions_granted: { type: DataTypes.JSON, allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_consents',
      timestamps: false,
    },
  )
}
