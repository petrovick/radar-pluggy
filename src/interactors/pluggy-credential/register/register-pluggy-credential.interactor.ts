import { ApplicationError } from '../../../shared/application-error.js'
import { PluggyCredential } from '../../../entities/pluggy-credential.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  RegisterPluggyCredentialGateway,
  RegisterPluggyCredentialInput,
  RegisterPluggyCredentialOutput,
} from './register-pluggy-credential.types.js'

// Orquestra o cadastro de credencial (design.md D7, configuracao-credenciais-pluggy): cria a
// credencial, vincula o itemId a ela e provisiona o webhook (PENDENCIAS.md 3.1). Três passos, sem
// transação entre eles — reafirmado, não só herdado dos dois primeiros: o terceiro é uma chamada de
// rede à Pluggy (mais propensa a falhar do que um `INSERT`), e mesmo assim a resposta é a mesma dos
// dois primeiros — falha nomeada, sem desfazer o que já foi persistido. Motivo: reconciliação
// (`POST /webhooks/pluggy/reconcile`) já existe como caminho de correção idempotente para credencial
// sem webhook (tasks.md 7.4) — reverter aqui duplicaria esse mecanismo. Reenviar o mesmo cadastro após
// essa falha recusa nomeado (`PLUGGY_CREDENTIAL_CLIENT_ID_ALREADY_REGISTERED`,
// `PluggyCredentialRep.create`), não um erro genérico de banco.
//
// Uma dependência só, o gateway do próprio caso de uso (arquitetura-camadas, regra 2).
export class RegisterPluggyCredentialInteractor {
  private readonly gateway: RegisterPluggyCredentialGateway

  constructor(params: AppContainer) {
    this.gateway = params.registerPluggyCredentialImpl
  }

  async execute(input: RegisterPluggyCredentialInput): Promise<RegisterPluggyCredentialOutput> {
    this.gateway.addContext({ messageType: 'REGISTER_PLUGGY_CREDENTIAL', personId: input.personId })

    try {
      if (input.itemId.trim().length === 0) {
        return { error: new ApplicationError('PLUGGY_CREDENTIAL_FIELD_MISSING', { field: 'itemId' }) }
      }

      PluggyCredential.create({
        personId: input.personId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      })

      await this.gateway.checkItemAvailable(input.itemId)

      await this.gateway.validateItemAccess({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        itemId: input.itemId,
      })

      const credentialId = await this.gateway.saveCredentialWithItemLink({
        personId: input.personId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        itemId: input.itemId,
      })

      await this.gateway.provisionWebhook(credentialId)

      this.gateway.logInfo('Credencial cadastrada, item vinculado e webhook provisionado', { credentialId })
      return { data: { credentialId } }
    } catch (err) {
      this.gateway.logError('Erro no cadastro de credencial', { err })
      // `clientId`/`clientSecret` ausentes chegam aqui como ApplicationError da entidade, com o
      // errorType e o campo que ela já nomeia — o caso de uso não os revalida nem os renomeia.
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_CREDENTIAL_REGISTRATION_FAILED') }
    }
  }
}
