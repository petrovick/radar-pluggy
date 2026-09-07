import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, a migration de radar_pluggy_loans — ver teste de contrato em
// tests/infra/db/models/pluggy-loan-model.contract.test.ts. Atributos em snake_case, iguais à
// coluna: a tradução para camelCase acontece só no repositório (modelagem-de-dados).
export interface PluggyLoanRow {
  id: number
  loan_id: string
  item_id: string
  contract_number: string | null
  product_name: string
  type: string | null
  kind: string
  collected_at: Date | null
  contract_date: Date | null
  settlement_date: Date | null
  contract_amount: string | null
  currency_code: string
  due_date: Date | null
  total_installments: number | null
  paid_installments: number | null
  due_installments: number | null
  past_due_installments: number | null
  outstanding_balance: string | null
  ipoc_code: string | null
  disbursement_dates: string[] | null
  first_installment_due_date: Date | null
  cet: string | null
  installment_periodicity: string | null
  installment_periodicity_additional_info: string | null
  amortization_scheduled: string | null
  amortization_scheduled_additional_info: string | null
  cnpj_consignee: string | null
  interest_rates: Record<string, unknown>[] | null
  contracted_fees: Record<string, unknown>[] | null
  contracted_finance_charges: Record<string, unknown>[] | null
  warranties: Record<string, unknown>[] | null
  installments: Record<string, unknown> | null
  payments: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export function definePluggyLoanModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyLoanRow>>(
    'PluggyLoan',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      loan_id: { type: DataTypes.STRING(36), allowNull: false },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      contract_number: { type: DataTypes.STRING(60), allowNull: true },
      product_name: { type: DataTypes.STRING(255), allowNull: false },
      type: { type: DataTypes.STRING(100), allowNull: true },
      kind: { type: DataTypes.STRING(40), allowNull: false },
      collected_at: { type: DataTypes.DATE(3), allowNull: true },
      contract_date: { type: DataTypes.DATE(3), allowNull: true },
      settlement_date: { type: DataTypes.DATE(3), allowNull: true },
      contract_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      due_date: { type: DataTypes.DATE(3), allowNull: true },
      total_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      paid_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      due_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      past_due_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      outstanding_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      ipoc_code: { type: DataTypes.STRING(60), allowNull: true },
      disbursement_dates: { type: DataTypes.JSON, allowNull: true },
      first_installment_due_date: { type: DataTypes.DATE(3), allowNull: true },
      cet: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      installment_periodicity: { type: DataTypes.STRING(40), allowNull: true },
      installment_periodicity_additional_info: { type: DataTypes.STRING(255), allowNull: true },
      amortization_scheduled: { type: DataTypes.STRING(40), allowNull: true },
      amortization_scheduled_additional_info: { type: DataTypes.STRING(255), allowNull: true },
      cnpj_consignee: { type: DataTypes.STRING(20), allowNull: true },
      interest_rates: { type: DataTypes.JSON, allowNull: true },
      contracted_fees: { type: DataTypes.JSON, allowNull: true },
      contracted_finance_charges: { type: DataTypes.JSON, allowNull: true },
      warranties: { type: DataTypes.JSON, allowNull: true },
      installments: { type: DataTypes.JSON, allowNull: true },
      payments: { type: DataTypes.JSON, allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_loans',
      timestamps: false,
    },
  )
}
