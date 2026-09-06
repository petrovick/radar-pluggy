import { UniqueConstraintError, type Model, type ModelStatic } from 'sequelize'
import { PluggyCredential, type PluggyCredentialWebhook } from '../../entities/pluggy-credential.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyCredentialRow } from '../../infra/db/models/pluggy-credential-model.js'
import { decryptSecret, encryptSecret } from '../../shared/pluggy-credential-cipher.js'
import { ApplicationError } from '../../shared/application-error.js'

export interface CreatePluggyCredentialInput {
  personId: number | undefined
  clientId: string
  clientSecret: string
}

export class PluggyCredentialRep {
  private readonly model: ModelStatic<Model<PluggyCredentialRow>>
  private readonly getTransaction: GetTransaction
  private readonly credentialEncryptionKey: string

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyCredential
    this.getTransaction = params.getTransaction
    this.credentialEncryptionKey = params.credentialEncryptionKey
  }

  // Sem findOrCreate: diferente de pluggy_connector_items (dado reentregue pela Pluggy), esta tabela recebe
  // cadastro único vindo do cliente — duplicar client_id é erro do chamador, não reentrega esperada,
  // e a constraint de unicidade do banco já recusa (modelagem-de-dados).
  //
  // A violação vira recusa nomeada, não erro de banco cru: desde que o cadastro passou a provisionar
  // o webhook no mesmo fluxo (register-pluggy-credential, PENDENCIAS.md 3.1), reenviar o cadastro após
  // uma falha no provisionamento é um caminho real, não só teórico — e sem isso o titular via
  // `PLUGGY_CREDENTIAL_REGISTRATION_FAILED` genérico, que não distingue "credencial já existe, falta só
  // provisionar" de "cadastro falhou do zero".
  async create(input: CreatePluggyCredentialInput): Promise<PluggyCredential> {
    const draft = PluggyCredential.create(input)

    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    try {
      const row = await this.model.create(
        {
          person_id: draft.getPersonId(),
          client_id: draft.getClientId(),
          client_secret: encryptSecret(draft.getClientSecret(), this.credentialEncryptionKey),
          created_at: now,
          updated_at: now,
        } as PluggyCredentialRow,
        transaction ? { transaction } : {},
      )

      return toEntity(row.get(), this.credentialEncryptionKey)
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new ApplicationError('PLUGGY_CREDENTIAL_CLIENT_ID_ALREADY_REGISTERED', { clientId: draft.getClientId() })
      }
      throw err
    }
  }

  // Provisionamento do webhook: grava o segredo de entrada cifrado e o que a Pluggy devolveu
  // (id, url, evento). Idempotente por credencial — rotação atualiza a mesma linha, nunca cria uma
  // segunda inscrição (tasks.md 7.1).
  async saveWebhook(credentialId: number, webhook: PluggyCredentialWebhook): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.update(
      {
        webhook_secret: encryptSecret(webhook.secret, this.credentialEncryptionKey),
        webhook_id: webhook.webhookId,
        webhook_url: webhook.url,
        webhook_event: webhook.event,
        updated_at: new Date(),
      } as Partial<PluggyCredentialRow>,
      { where: { id: credentialId }, ...(transaction ? { transaction } : {}) },
    )
  }

  async findAll(): Promise<PluggyCredential[]> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll(transaction ? { transaction } : {})
    return rows.map((row) => toEntity(row.get(), this.credentialEncryptionKey))
  }

  async findById(id: number): Promise<PluggyCredential | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findByPk(id, transaction ? { transaction } : {})
    return row ? toEntity(row.get(), this.credentialEncryptionKey) : undefined
  }

  async findByPersonId(personId: number): Promise<PluggyCredential[]> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll({
      where: { person_id: personId },
      ...(transaction ? { transaction } : {}),
    })
    return rows.map((row) => toEntity(row.get(), this.credentialEncryptionKey))
  }
}

export function toEntity(row: PluggyCredentialRow, credentialEncryptionKey: string): PluggyCredential {
  return PluggyCredential.reconstitute({
    id: row.id,
    personId: row.person_id,
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret, credentialEncryptionKey),
    // Um webhook só está provisionado quando as quatro colunas existem; qualquer combinação parcial
    // é provisionamento interrompido, e é tratada como "não provisionado" pela reconciliação.
    ...(row.webhook_secret && row.webhook_id && row.webhook_url && row.webhook_event
      ? {
          webhook: {
            secret: decryptSecret(row.webhook_secret, credentialEncryptionKey),
            webhookId: row.webhook_id,
            url: row.webhook_url,
            event: row.webhook_event,
          },
        }
      : {}),
  })
}
