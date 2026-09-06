// Captura integral do schema `Account` da Pluggy (change pluggy-complete-data-capture, spec
// pluggy-account): `taxNumber` (CPF/CNPJ do titular — decisão explícita do usuário), `bankData`
// inteiro (só presente em conta BANK) e `disaggregatedCreditLimits` (reverte a exclusão de propósito
// documentada em 20260905120000). Todas aditivas e opcionais.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_accounts', 'tax_number', {
      type: Sequelize.STRING(20),
      allowNull: true,
    })
    // Objeto `BankData` inteiro (closingBalance, automaticallyInvestedBalance,
    // overdraftContractedLimit, overdraftUsedLimit, unarrangedOverdraftAmount, hasReservedBalance,
    // reservedBalances) — JSON, mesma decisão de `metadata` em pluggy_connector_positions.
    await queryInterface.addColumn('pluggy_connector_accounts', 'bank_data', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_accounts', 'disaggregated_credit_limits', {
      type: Sequelize.JSON,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pluggy_connector_accounts', 'disaggregated_credit_limits')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'bank_data')
    await queryInterface.removeColumn('pluggy_connector_accounts', 'tax_number')
  },
}
