module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('pluggy_connector_positions', 'quantity', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.changeColumn('pluggy_connector_positions', 'balance', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: false,
    })
    await queryInterface.changeColumn('pluggy_connector_positions', 'amount_original', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'value', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'amount', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'taxes', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'taxes2', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('pluggy_connector_positions', 'taxes2')
    await queryInterface.removeColumn('pluggy_connector_positions', 'taxes')
    await queryInterface.removeColumn('pluggy_connector_positions', 'amount')
    await queryInterface.removeColumn('pluggy_connector_positions', 'value')
    await queryInterface.changeColumn('pluggy_connector_positions', 'amount_original', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    })
    await queryInterface.changeColumn('pluggy_connector_positions', 'balance', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
    })
    await queryInterface.changeColumn('pluggy_connector_positions', 'quantity', {
      type: Sequelize.DECIMAL(14, 8),
      allowNull: true,
    })
  },
}
