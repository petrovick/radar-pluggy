import type { PluggyCredential } from '../../entities/pluggy-credential.js'
import type { AppContainer } from '../../infra/bootstrap/register.js'
import { ApplicationError } from '../../shared/application-error.js'
import type { PluggyClientGateway, PluggyConnectorClient } from './pluggy-client.gateway.js'
import type { PluggyCredentialItemRep } from '../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../repositories/pluggy-credential.rep.js'
import type { PluggyCallRecorder } from './pluggy-call-recorder.js'
import { instrumentPluggyClient } from './pluggy-call-instrumentation.js'

// União discriminada em vez de `PluggyCredential | undefined` interno: o "por que faltou" precisa
// sobreviver até quem chama, e é o compilador que garante que os dois casos foram tratados.
type ItemCredentialResolution =
  | { credential: PluggyCredential }
  | { missing: 'LINK' }
  | { missing: 'CREDENTIAL'; credentialId: number }

// Resolve "de quem é este item" e "com que chave eu falo com a Pluggy por ele" — o mecanismo de
// autenticação que nenhum caso de uso deve conhecer (arquitetura-camadas, 2.2.1).
//
// Nasceu extraído, não antecipado: viveu como método privado dentro de `SyncPluggyPositionImpl` até
// `LoadPluggyHistoryImpl` precisar do mesmo, que é o gatilho que a regra 2.3.1 define para extrair.
// Não é interactor: é consulta com invariante, consumida só por adapters. Por isso `.resolver.ts` e
// não `.gateway.ts` — gateway de borda não toca banco, e esta classe compõe dois repositórios
// (arquitetura-camadas, seção 1).
//
// `scoped` no container: a credencial é resolvida uma vez por unidade de trabalho. O cliente do SDK
// vem do cache do `PluggyClientGateway` (singleton), que é quem faz a api key sobreviver ao escopo.
export class PluggyItemCredentialResolver {
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyClientGateway: PluggyClientGateway
  private readonly pluggyCallRecorder: PluggyCallRecorder
  private readonly resolved = new Map<string, PluggyCredential>()
  private readonly instrumentedClients = new Map<string, PluggyConnectorClient>()

  constructor(params: AppContainer) {
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyClientGateway = params.pluggyClientGateway
    this.pluggyCallRecorder = params.pluggyCallRecorder
  }

  // Variante que não lança, para quem precisa recusar sem contar ao chamador *por que* recusou — o
  // handler do webhook devolve a mesma resposta para "item desconhecido" e "assinatura inválida", de
  // propósito. Ausência é `undefined`; falha de banco continua estourando, nunca vira "não achei".
  async findCredentialFor(itemId: string): Promise<PluggyCredential | undefined> {
    const resolution = await this.resolve(itemId)
    return 'credential' in resolution ? resolution.credential : undefined
  }

  // As duas ausências são recusas nomeadas distintas: item sem vínculo nunca recebe dono por
  // inferência (D7). Quem sincroniza precisa saber qual das duas foi.
  async credentialFor(itemId: string): Promise<PluggyCredential> {
    const resolution = await this.resolve(itemId)
    if ('credential' in resolution) {
      return resolution.credential
    }
    if (resolution.missing === 'LINK') {
      throw new ApplicationError('PLUGGY_CREDENTIAL_ITEM_NOT_LINKED', { itemId })
    }
    throw new ApplicationError('PLUGGY_CREDENTIAL_NOT_FOUND', { itemId, credentialId: resolution.credentialId })
  }

  // `itemId` só existe através de uma Application específica (design.md D5), então a busca nunca é
  // ambígua por pessoa. Qual das duas ausências ocorreu vira decisão de quem chama, não daqui.
  private async resolve(itemId: string): Promise<ItemCredentialResolution> {
    const cached = this.resolved.get(itemId)
    if (cached) {
      return { credential: cached }
    }

    const credentialId = await this.pluggyCredentialItemRep.findCredentialIdByItemId(itemId)
    if (credentialId === undefined) {
      return { missing: 'LINK' }
    }

    const credential = await this.pluggyCredentialRep.findById(credentialId)
    if (credential === undefined) {
      return { missing: 'CREDENTIAL', credentialId }
    }

    this.resolved.set(itemId, credential)
    return { credential }
  }

  // Cliente do SDK já autenticável para aquele item. Não devolve api key: quem autentica é o SDK, por
  // dentro, e nenhuma assinatura nossa carrega segredo (padroes-de-engenharia, 3b).
  //
  // Instrumentado (design.md D3/D22): toda chamada feita por este cliente gera linha em
  // `radar_pluggy_calls` com `item_id` preenchido e `connector_id` quando já conhecido. Cacheado por
  // itemId, não só por clientId — o Proxy de instrumentação embrulha o client cacheado do gateway
  // (compartilhado entre itens da mesma credencial), mas o `item_id` gravado é por item.
  async clientFor(itemId: string): Promise<PluggyConnectorClient> {
    const cached = this.instrumentedClients.get(itemId)
    if (cached) {
      return cached
    }

    const credential = await this.credentialFor(itemId)
    const client = this.pluggyClientGateway.clientFor(credential.getClientId(), credential.getClientSecret())
    const connectorId = (await this.pluggyCredentialItemRep.findByItemId(itemId))?.connectorId
    const instrumented = instrumentPluggyClient(client, { itemId, connectorId }, this.pluggyCallRecorder)
    this.instrumentedClients.set(itemId, instrumented)
    return instrumented
  }
}
