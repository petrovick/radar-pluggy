module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_positions', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      // id do investimento na Pluggy — junto com item_id, identifica a fotografia (design.md D2,
      // sincronizacao-posicao-pluggy: mais recente por item + investimento, sem histórico).
      investment_id: { type: Sequelize.STRING(36), allowNull: false },
      type: { type: Sequelize.STRING(20), allowNull: false },
      subtype: { type: Sequelize.STRING(30), allowNull: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      code: { type: Sequelize.STRING(60), allowNull: true },
      isin: { type: Sequelize.STRING(12), allowNull: true },
      currency_code: { type: Sequelize.STRING(3), allowNull: false },
      balance: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(14, 8), allowNull: true },
      amount_original: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: true },
      institution_name: { type: Sequelize.STRING(255), allowNull: true },
      institution_number: { type: Sequelize.STRING(30), allowNull: true },
      quota_date: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Idempotência de escrita (modelagem-de-dados): reentrega/nova sincronização do mesmo investimento
    // upserta sobre esta constraint, nunca duplica.
    await queryInterface.addIndex('pluggy_positions', ['item_id', 'investment_id'], {
      name: 'uq_pluggy_positions_item_investment',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pluggy_positions')
  },
}
