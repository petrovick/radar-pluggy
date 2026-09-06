// Fotografia atual do empréstimo (lado passivo do patrimônio, análogo a pluggy_connector_positions
// para investimentos): uma linha por loan_id — id da Pluggy já é globalmente único, então a
// idempotência não precisa de item_id + loan_id como em posições (design.md, sincronização de loans).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_loans', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      loan_id: { type: Sequelize.STRING(36), allowNull: false },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      contract_number: { type: Sequelize.STRING(60), allowNull: true },
      product_name: { type: Sequelize.STRING(255), allowNull: false },
      type: { type: Sequelize.STRING(100), allowNull: true },
      kind: { type: Sequelize.STRING(40), allowNull: false },
      collected_at: { type: Sequelize.DATE(3), allowNull: true },
      contract_date: { type: Sequelize.DATE(3), allowNull: true },
      settlement_date: { type: Sequelize.DATE(3), allowNull: true },
      contract_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      due_date: { type: Sequelize.DATE(3), allowNull: true },
      total_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      paid_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      due_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      past_due_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // `payments.contractOutstandingBalance` — o dado central: o saldo devedor atual.
      outstanding_balance: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Idempotência de escrita (modelagem-de-dados): reentrega/nova sincronização do mesmo empréstimo
    // upserta sobre esta constraint, nunca duplica.
    await queryInterface.addIndex('pluggy_connector_loans', ['loan_id'], {
      name: 'uq_pluggy_connector_loans_loan_id',
      unique: true,
    })

    await queryInterface.addIndex('pluggy_connector_loans', ['item_id'], {
      name: 'idx_pluggy_connector_loans_item',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('pluggy_connector_loans', 'idx_pluggy_connector_loans_item')
    await queryInterface.removeIndex('pluggy_connector_loans', 'uq_pluggy_connector_loans_loan_id')
    await queryInterface.dropTable('pluggy_connector_loans')
  },
}
