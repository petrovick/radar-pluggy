// Histórico da evolução do saldo devedor — uma linha por sincronização (design.md, sincronização de
// loans). Diferente de pluggy_connector_position_snapshots, não existe uma data de cotação do
// provedor para agrupar por dia (`Loan` não tem equivalente a `quotaDate`), então a granularidade da
// unicidade é o próprio instante da sincronização (synced_at), não uma data de negócio.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_loan_snapshots', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      loan_id: { type: Sequelize.STRING(36), allowNull: false },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      outstanding_balance: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      total_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      paid_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      due_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      past_due_installments: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      synced_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_loan_snapshots', ['item_id', 'loan_id', 'synced_at'], {
      name: 'uq_pluggy_connector_loan_snapshots_item_loan_synced',
      unique: true,
    })

    await queryInterface.addIndex('pluggy_connector_loan_snapshots', ['item_id', 'synced_at'], {
      name: 'idx_pluggy_connector_loan_snapshots_item_synced',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_loan_snapshots',
      'idx_pluggy_connector_loan_snapshots_item_synced',
    )
    await queryInterface.removeIndex(
      'pluggy_connector_loan_snapshots',
      'uq_pluggy_connector_loan_snapshots_item_loan_synced',
    )
    await queryInterface.dropTable('pluggy_connector_loan_snapshots')
  },
}
