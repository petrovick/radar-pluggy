module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_account_transactions', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      account_id: { type: Sequelize.STRING(36), allowNull: false },
      transaction_id: { type: Sequelize.STRING(36), allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: false },
      description_raw: { type: Sequelize.STRING(255), allowNull: true },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      amount: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      amount_in_account_currency: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      balance: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      date: { type: Sequelize.DATE(3), allowNull: false },
      transaction_type: { type: Sequelize.STRING(30), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false },
      category_id: { type: Sequelize.STRING(36), allowNull: true },
      category: { type: Sequelize.STRING(100), allowNull: true },
      operation_type: { type: Sequelize.STRING(50), allowNull: true },
      operation_type_additional_info: { type: Sequelize.STRING(255), allowNull: true },
      provider_code: { type: Sequelize.STRING(50), allowNull: true },
      provider_id: { type: Sequelize.STRING(60), allowNull: true },
      source_order: { type: Sequelize.INTEGER, allowNull: true },
      merchant: { type: Sequelize.JSON, allowNull: true },
      payment_data: { type: Sequelize.JSON, allowNull: true },
      provider_created_at: { type: Sequelize.DATE(3), allowNull: false },
      provider_updated_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex(
      'pluggy_connector_account_transactions',
      ['item_id', 'account_id', 'transaction_id'],
      {
        name: 'uq_pluggy_connector_account_transactions_item_account_tx',
        unique: true,
      },
    )

    await queryInterface.addIndex(
      'pluggy_connector_account_transactions',
      ['item_id', 'account_id', 'date'],
      {
        name: 'idx_pluggy_connector_account_transactions_item_account_date',
      },
    )
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_account_transactions',
      'idx_pluggy_connector_account_transactions_item_account_date',
    )
    await queryInterface.removeIndex(
      'pluggy_connector_account_transactions',
      'uq_pluggy_connector_account_transactions_item_account_tx',
    )
    await queryInterface.dropTable('pluggy_connector_account_transactions')
  },
}
