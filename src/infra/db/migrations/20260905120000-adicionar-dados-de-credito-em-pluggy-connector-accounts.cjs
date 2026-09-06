// Campos de nível superior de `CreditData` (SDK `pluggy-sdk`, `account.d.ts`), presentes só quando
// `type = 'CREDIT'` e a Pluggy devolve `creditData` não nulo — por isso todas nullable, sem default.
// `disaggregatedCreditLimits` fica de fora de propósito: lista aninhada complexa, só devolvida por
// conector Open Finance, fora do escopo desta migration.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_accounts', 'level', {
      type: Sequelize.STRING(30),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'brand', {
      type: Sequelize.STRING(30),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'brand_additional_info', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'balance_close_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'balance_due_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'available_credit_limit', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'balance_foreign_currency', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'minimum_payment', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'credit_limit', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'is_limit_flexible', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'status', {
      type: Sequelize.STRING(20),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'holder_type', {
      type: Sequelize.STRING(20),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    // Ordem inversa exata do `up`.
    await queryInterface.removeColumn('pluggy_connector_accounts', 'holder_type')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'status')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'is_limit_flexible')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'credit_limit')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'minimum_payment')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'balance_foreign_currency')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'available_credit_limit')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'balance_due_date')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'balance_close_date')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'brand_additional_info')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'brand')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'level')
  },
}
