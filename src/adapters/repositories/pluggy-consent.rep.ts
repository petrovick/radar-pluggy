import { UniqueConstraintError, type Model, type ModelStatic } from 'sequelize'
import { PluggyConsent } from '../../entities/pluggy-consent.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyConsentRow } from '../../infra/db/models/pluggy-consent-model.js'
import { ApplicationError } from '../../shared/application-error.js'

export interface SavePluggyConsentInput {
  itemId: string
  consentId: string
  grantedAt: Date
  expiresAt: Date | undefined
  revokedAt: Date | undefined
}

export class PluggyConsentRep {
  private readonly model: ModelStatic<Model<PluggyConsentRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyConsent
    this.getTransaction = params.getTransaction
  }

  // Uma linha por item (item_id único): o consentimento mais recente conhecido substitui o anterior —
  // não é histórico de renovações, é o estado atual (modelagem-de-dados, idempotência de escrita:
  // findOrCreate sobre a constraint real, nunca "buscar e se não achar criar" em dois passos).
  //
  // `consent_id` também é único no banco (um consentimento da Pluggy nunca pertence a dois itens) —
  // violação vira recusa nomeada, nunca `UniqueConstraintError` cru do Sequelize (mesmo precedente de
  // `pluggy-credential.rep.ts`, `create`).
  async save(input: SavePluggyConsentInput): Promise<PluggyConsent> {
    const draft = PluggyConsent.create(input)
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    try {
      const [row, created] = await this.model.findOrCreate({
        where: { item_id: draft.getItemId() },
        defaults: {
          item_id: draft.getItemId(),
          consent_id: draft.getConsentId(),
          granted_at: draft.getGrantedAt(),
          expires_at: draft.getExpiresAt() ?? null,
          revoked_at: draft.getRevokedAt() ?? null,
          created_at: now,
          updated_at: now,
        } as PluggyConsentRow,
        ...(transaction ? { transaction } : {}),
      })

      if (created) {
        return draft
      }

      await row.update(
        {
          consent_id: draft.getConsentId(),
          granted_at: draft.getGrantedAt(),
          expires_at: draft.getExpiresAt() ?? null,
          revoked_at: draft.getRevokedAt() ?? null,
          updated_at: now,
        },
        transaction ? { transaction } : {},
      )

      return draft
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new ApplicationError('PLUGGY_CONSENT_ID_CONFLICT', {
          consentId: draft.getConsentId(),
          itemId: draft.getItemId(),
        })
      }
      throw err
    }
  }
}
