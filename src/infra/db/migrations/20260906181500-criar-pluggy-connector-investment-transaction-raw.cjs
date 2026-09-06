// Log append-only do payload bruto de cada item de `GET /investments/{id}/transactions` (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit). Sem chave única.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_investment_transaction_raw', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      investment_id: { type: Sequelize.STRING(36), allowNull: false },
      transaction_id: { type: Sequelize.STRING(36), allowNull: false },
      raw_payload: { type: Sequelize.JSON, allowNull: false },
      captured_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex(
      'pluggy_connector_investment_transaction_raw',
      ['item_id', 'investment_id', 'transaction_id'],
      { name: 'idx_pluggy_connector_inv_tx_raw_item_investment_tx' },
    )
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_investment_transaction_raw',
      'idx_pluggy_connector_inv_tx_raw_item_investment_tx',
    )
    await queryInterface.dropTable('pluggy_connector_investment_transaction_raw')
  },
}
