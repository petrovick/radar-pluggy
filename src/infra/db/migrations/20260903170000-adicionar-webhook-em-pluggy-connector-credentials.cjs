// Segredo de ENTRADA do webhook, por credencial (design.md D7). Nunca é o `client_secret`: aquele é
// a credencial de SAÍDA, usada em `POST /auth`. Reaproveitar um como o outro daria ao remetente do
// webhook o poder de ler dado bancário.
//
// Todas nullable: a tabela já tem linhas de credenciais cadastradas antes do webhook existir, e o
// provisionamento é uma operação explícita posterior (tasks.md 7.4) — não há valor a inventar aqui.
// `webhook_secret` usa STRING(512), igual a `client_secret`, porque guarda o mesmo formato cifrado
// (iv:authTag:ciphertext em base64).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pluggy_connector_credentials', 'webhook_secret', {
      type: Sequelize.STRING(512),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_credentials', 'webhook_id', {
      type: Sequelize.STRING(36),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_credentials', 'webhook_url', {
      type: Sequelize.STRING(255),
      allowNull: true,
    })
    await queryInterface.addColumn('pluggy_connector_credentials', 'webhook_event', {
      type: Sequelize.STRING(50),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    // Ordem inversa exata do `up`.
    await queryInterface.removeColumn('pluggy_connector_credentials', 'webhook_event')
    await queryInterface.removeColumn('pluggy_connector_credentials', 'webhook_url')
    await queryInterface.removeColumn('pluggy_connector_credentials', 'webhook_id')
    await queryInterface.removeColumn('pluggy_connector_credentials', 'webhook_secret')
  },
}
