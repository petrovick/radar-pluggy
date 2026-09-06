module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_investment_transactions', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      investment_id: { type: Sequelize.STRING(36), allowNull: false },
      transaction_id: { type: Sequelize.STRING(36), allowNull: false },
      type: { type: Sequelize.STRING(30), allowNull: false },
      movement_type: { type: Sequelize.STRING(30), allowNull: true },
      quantity: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      amount: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      net_amount: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      price_factor: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      indexer_percentage: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      agreed_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      date: { type: Sequelize.DATE(3), allowNull: false },
      trade_date: { type: Sequelize.DATE(3), allowNull: true },
      description: { type: Sequelize.STRING(255), allowNull: true },
      brokerage_number: { type: Sequelize.STRING(50), allowNull: true },
      service_tax: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      brokerage_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      income_tax: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      trading_assets_notice_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      maintenance_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      settlement_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      clearing_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      stock_exchange_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      custody_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      operating_fee: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      other: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      iof: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      iof_provision: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex(
      'pluggy_connector_investment_transactions',
      ['item_id', 'investment_id', 'transaction_id'],
      {
        name: 'uq_pluggy_connector_inv_transactions_item_inv_tx',
        unique: true,
      },
    )

    await queryInterface.addIndex(
      'pluggy_connector_investment_transactions',
      ['item_id', 'investment_id', 'date'],
      {
        name: 'idx_pluggy_connector_inv_transactions_item_inv_date',
      },
    )
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_investment_transactions',
      'idx_pluggy_connector_inv_transactions_item_inv_date',
    )
    await queryInterface.removeIndex(
      'pluggy_connector_investment_transactions',
      'uq_pluggy_connector_inv_transactions_item_inv_tx',
    )
    await queryInterface.dropTable('pluggy_connector_investment_transactions')
  },
}
