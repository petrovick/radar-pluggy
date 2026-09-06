// Captura integral do schema `Loan` da Pluggy (change pluggy-complete-data-capture, spec
// pluggy-loan): reverte o corte documentado em entities/pluggy-loan.ts — o serviço guardava só a
// visão patrimonial ("quanto eu devo"), agora guarda o contrato inteiro. Campos escalares viram
// coluna própria; lista/objeto aninhado (interestRates, contractedFees, contractedFinanceCharges,
// warranties, installments, payments) vira JSON — mesma decisão já usada em `metadata` de
// pluggy_connector_positions e `bank_data` de pluggy_connector_accounts.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_loans', 'ipoc_code', {
      type: Sequelize.STRING(60),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'disbursement_dates', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'first_installment_due_date', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'cet', {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'installment_periodicity', {
      type: Sequelize.STRING(40),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'installment_periodicity_additional_info', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'amortization_scheduled', {
      type: Sequelize.STRING(40),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'amortization_scheduled_additional_info', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'cnpj_consignee', {
      type: Sequelize.STRING(20),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'interest_rates', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'contracted_fees', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'contracted_finance_charges', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_loans', 'warranties', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    // Objeto `LoanInstallments` inteiro (typeNumberOfInstallments, typeContractRemaining,
    // contractRemainingNumber, balloonPayments) — as contagens (total/paid/due/pastDue) já têm
    // coluna própria desde a migration original; este JSON complementa com o resto do objeto.
    await queryInterface.addColumn('pluggy_connector_loans', 'installments', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    // Objeto `LoanPayments` inteiro (contractOutstandingBalance já tem coluna própria
    // `outstanding_balance`; este JSON complementa com `releases`).
    await queryInterface.addColumn('pluggy_connector_loans', 'payments', {
      type: Sequelize.JSON,
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pluggy_connector_loans', 'payments')
    await queryInterface.removeColumn('pluggy_connector_loans', 'installments')
    await queryInterface.removeColumn('pluggy_connector_loans', 'warranties')
    await queryInterface.removeColumn('pluggy_connector_loans', 'contracted_finance_charges')
    await queryInterface.removeColumn('pluggy_connector_loans', 'contracted_fees')
    await queryInterface.removeColumn('pluggy_connector_loans', 'interest_rates')
    await queryInterface.removeColumn('pluggy_connector_loans', 'cnpj_consignee')
    await queryInterface.removeColumn('pluggy_connector_loans', 'amortization_scheduled_additional_info')
    await queryInterface.removeColumn('pluggy_connector_loans', 'amortization_scheduled')
    await queryInterface.removeColumn('pluggy_connector_loans', 'installment_periodicity_additional_info')
    await queryInterface.removeColumn('pluggy_connector_loans', 'installment_periodicity')
    await queryInterface.removeColumn('pluggy_connector_loans', 'cet')
    await queryInterface.removeColumn('pluggy_connector_loans', 'first_installment_due_date')
    await queryInterface.removeColumn('pluggy_connector_loans', 'disbursement_dates')
    await queryInterface.removeColumn('pluggy_connector_loans', 'ipoc_code')
  },
}
