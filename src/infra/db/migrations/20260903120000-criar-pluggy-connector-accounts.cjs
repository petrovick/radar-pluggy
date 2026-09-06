module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_accounts', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      account_id: { type: Sequelize.STRING(36), allowNull: false },
      type: { type: Sequelize.STRING(30), allowNull: false },
      subtype: { type: Sequelize.STRING(30), allowNull: true },
      number: { type: Sequelize.STRING(50), allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      marketing_name: { type: Sequelize.STRING(255), allowNull: true },
      balance: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      owner: { type: Sequelize.STRING(255), allowNull: true },
      provider_created_at: { type: Sequelize.DATE(3), allowNull: false },
      provider_updated_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_accounts', ['item_id', 'account_id'], {
      name: 'uq_pluggy_connector_accounts_item_account',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('pluggy_connector_accounts', 'uq_pluggy_connector_accounts_item_account')
    await queryInterface.dropTable('pluggy_connector_accounts')
  },
}
