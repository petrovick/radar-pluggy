// Captura de `products` e `openFinancePermissionsGranted` (change pluggy-complete-data-capture,
// spec pluggy-consent) — o que o titular autorizou, não só até quando. Listas de string; JSON, mesma
// decisão de `merchant`/`payment_data` em pluggy_connector_account_transactions.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_consents', 'products', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_consents', 'open_finance_permissions_granted', {
      type: Sequelize.JSON,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pluggy_connector_consents', 'open_finance_permissions_granted')
    await queryInterface.removeColumn('pluggy_connector_consents', 'products')
  },
}
