module.exports = {
  async up(queryInterface, Sequelize) {
    // person_id é coluna simples, sem `references`/`onDelete` — people pertence ao histórico de
    // migration do oplab-radar-api; uma FK física aqui imporia constraint sobre uma tabela que
    // este serviço só lê (fronteira-pluggy regra 13, modelagem-de-dados regra 1).
    await queryInterface.createTable('pluggy_credentials', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      person_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false },
      client_id: { type: Sequelize.STRING(64), allowNull: false },
      // Cifrado na aplicação (AES-256-GCM) antes de gravar — nunca texto plano (design.md D6,
      // configuracao-credenciais-pluggy). Tamanho cobre iv+authTag+ciphertext em base64.
      client_secret: { type: Sequelize.STRING(512), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Unicidade de negócio: uma Application da Pluggy nunca é cadastrada duas vezes.
    await queryInterface.addIndex('pluggy_credentials', ['client_id'], {
      name: 'uq_pluggy_credentials_client_id',
      unique: true,
    })

    await queryInterface.addIndex('pluggy_credentials', ['person_id'], {
      name: 'idx_pluggy_credentials_person',
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pluggy_credentials')
  },
}
