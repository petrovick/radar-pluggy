module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_position_snapshots', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      investment_id: { type: Sequelize.STRING(36), allowNull: false },
      quota_date: { type: Sequelize.DATE(3), allowNull: false },
      balance: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
      amount: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      amount_original: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      taxes: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      taxes2: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      synced_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex(
      'pluggy_connector_position_snapshots',
      ['item_id', 'investment_id', 'quota_date'],
      {
        name: 'uq_pluggy_connector_position_snapshots_item_investment_date',
        unique: true,
      },
    )

    await queryInterface.addIndex('pluggy_connector_position_snapshots', ['item_id', 'quota_date'], {
      name: 'idx_pluggy_connector_position_snapshots_item_date',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_position_snapshots',
      'idx_pluggy_connector_position_snapshots_item_date',
    )
    await queryInterface.removeIndex(
      'pluggy_connector_position_snapshots',
      'uq_pluggy_connector_position_snapshots_item_investment_date',
    )
    await queryInterface.dropTable('pluggy_connector_position_snapshots')
  },
}
