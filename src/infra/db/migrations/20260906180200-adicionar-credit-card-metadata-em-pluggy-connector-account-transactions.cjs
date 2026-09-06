// Captura de `creditCardMetadata` (change pluggy-complete-data-capture, spec
// pluggy-transaction-history): objeto inteiro (parcelamento, billId, billForecastDate, tipo de
// tarifa), hoje nunca lido pelo gateway. Presente só quando a transação é de cartão de crédito.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_account_transactions', 'credit_card_metadata', {
      type: Sequelize.JSON,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pluggy_connector_account_transactions', 'credit_card_metadata')
  },
}
