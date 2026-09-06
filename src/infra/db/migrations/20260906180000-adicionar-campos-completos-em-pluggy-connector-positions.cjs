// Captura integral do schema `Investment` da Pluggy (change pluggy-complete-data-capture, spec
// pluggy-position-sync): campos que o gateway hoje descarta antes de chegar à entity. Todos
// aditivos e opcionais — investimento sem o atributo continua sem recusa.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_positions', 'issuer_cnpj', {
      type: Sequelize.STRING(20),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'number', {
      type: Sequelize.STRING(60),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'amount_withdrawal', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'amount_profit', {
      type: Sequelize.DECIMAL(20, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'due_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'issuer', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'issue_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'purchase_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'rate', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'rate_type', {
      type: Sequelize.STRING(40),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'fixed_annual_rate', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'last_month_rate', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'annual_rate', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'last_twelve_months_rate', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_positions', 'owner', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    // `metadata` do schema Investment (taxRegime/proposalNumber/processNumber) — objeto pequeno e
    // fechado, sem consulta por campo interno prevista; JSON em vez de três colunas finas.
    await queryInterface.addColumn('pluggy_connector_positions', 'metadata', {
      type: Sequelize.JSON,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pluggy_connector_positions', 'metadata')
    await queryInterface.removeColumn('pluggy_connector_positions', 'owner')
    await queryInterface.removeColumn('pluggy_connector_positions', 'last_twelve_months_rate')
    await queryInterface.removeColumn('pluggy_connector_positions', 'annual_rate')
    await queryInterface.removeColumn('pluggy_connector_positions', 'last_month_rate')
    await queryInterface.removeColumn('pluggy_connector_positions', 'fixed_annual_rate')
    await queryInterface.removeColumn('pluggy_connector_positions', 'rate_type')
    await queryInterface.removeColumn('pluggy_connector_positions', 'rate')
    await queryInterface.removeColumn('pluggy_connector_positions', 'purchase_date')
    await queryInterface.removeColumn('pluggy_connector_positions', 'issue_date')
    await queryInterface.removeColumn('pluggy_connector_positions', 'issuer')
    await queryInterface.removeColumn('pluggy_connector_positions', 'due_date')
    await queryInterface.removeColumn('pluggy_connector_positions', 'amount_profit')
    await queryInterface.removeColumn('pluggy_connector_positions', 'amount_withdrawal')
    await queryInterface.removeColumn('pluggy_connector_positions', 'number')
    await queryInterface.removeColumn('pluggy_connector_positions', 'issuer_cnpj')
  },
}
