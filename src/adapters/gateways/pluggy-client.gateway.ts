import { PluggyClient } from 'pluggy-sdk'
import { randomUUID } from 'node:crypto'
import { ApplicationError } from '../../shared/application-error.js'
import { currentCallContext } from '../../infra/tools/call-context.js'
import type { PluggyCallRecorder } from './pluggy-call-recorder.js'
import type { PluggyCallFailureKind } from '../../entities/pluggy-call.js'

// O `fetchAccounts` do SDK aceita só `(itemId, type)` — **não** expõe `page`/`pageSize` (ele monta a
// query com esses dois campos e mais nada). Usá-lo puro deixaria a descoberta de contas presa na
// primeira página, com o `pageSize` default da Pluggy, truncando em silêncio o que a spec
// pluggy-account exige percorrer inteiro.
//
// A saída não é voltar a `fetch`: é estender o cliente e usar o `createGetRequest` protegido do
// `BaseApi`, que é a própria API de transporte do SDK. Assim a chamada ganha os parâmetros que
// faltavam e mantém tudo que o SDK dá — `/auth`, cache da api key, retry de 429 e a desserialização
// de data. Quando o SDK não tem o parâmetro, estenda o cliente; não reimplemente o transporte.
//
// `getApiKey` (design.md D1): autenticação só é observada no ponto real onde acontece — nunca
// simulada a partir de outra chamada. Um `Proxy` em volta do client (D3) intercepta só a chamada
// externa; o `POST /auth` real acontece DENTRO de `createGetRequest`/`createMutationRequest`, que
// chamam `this.getApiKey()` no `this` do objeto cru. Por isso o override é aqui, por herança
// (`getApiKey`/`apiKey`/`isJwtExpired` são `protected`, acessíveis por subclasse), não por Proxy.
export class PluggyConnectorClient extends PluggyClient {
  private pluggyCallRecorder: PluggyCallRecorder | undefined

  // Setter, não construtor: o SDK já define o construtor de `PluggyClient` com `ClientParams`
  // próprios — estender a assinatura obrigaria `PluggyClientGateway` a conhecer detalhe do SDK que
  // não é dele. Chamado uma vez, logo após a construção (D31).
  setCallRecorder(recorder: PluggyCallRecorder): void {
    this.pluggyCallRecorder = recorder
  }

  protected override async getApiKey(): Promise<string> {
    // Token em cache ainda válido: delega sem registrar nada (spec pluggy-call-history, "client com
    // token em cache não gera novo registro de autenticação").
    const cached = (this as unknown as { apiKey?: string }).apiKey
    const isJwtExpired = (this as unknown as { isJwtExpired: (token: string) => boolean }).isJwtExpired.bind(this)
    if (cached !== undefined && !isJwtExpired(cached)) {
      return super.getApiKey()
    }

    const startedAt = new Date()
    const ctx = currentCallContext()
    let httpStatus: number | undefined
    let outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED'
    let failureKind: PluggyCallFailureKind | undefined
    let errorCode: string | undefined

    try {
      return await super.getApiKey()
    } catch (error) {
      outcome = 'FAILED'
      const classified = classifyPluggyCallFailure(error)
      failureKind = classified.failureKind
      httpStatus = classified.httpStatus
      errorCode = classified.errorCode
      throw error
    } finally {
      // D25: nunca aguardado — a chamada real já terminou (sucesso ou exceção relançada) antes de
      // `record` ser sequer chamado; `record` em si nunca bloqueia quem chama.
      this.pluggyCallRecorder?.record({
        itemId: undefined,
        connectorId: undefined,
        operation: 'AUTH',
        httpMethod: 'POST',
        routeTemplate: '/auth',
        callScope: 'AUTH',
        trigger: ctx?.trigger ?? 'SYSTEM_INTERNAL',
        resourceType: undefined,
        resourceId: undefined,
        requestCorrelationId: ctx?.requestCorrelationId ?? randomUUID(),
        webhookEventId: ctx?.webhookEventId,
        pageOrdinal: undefined,
        pageSize: undefined,
        startedAt,
        completedAt: new Date(),
        httpStatus,
        outcome,
        failureKind,
        errorCode,
      })
    }
  }

  fetchAccountsPage(itemId: string, page: number, pageSize: number): Promise<unknown> {
    return this.createGetRequest('accounts', { itemId, page, pageSize })
  }
}

export interface PluggyClientGatewayParams {
  // Só para teste: injeta a construção do cliente. NÃO existe parâmetro de `baseUrl` aqui de
  // propósito — o `ClientParams` do SDK declara `baseUrl?: string` e o construtor do `BaseApi`
  // **nunca o lê**: ele resolve `process.env.PLUGGY_API_URL || 'https://api.pluggy.ai'`. Aceitar um
  // `baseUrl` que não tem efeito seria mentir na assinatura.
  createClient?: (clientId: string, clientSecret: string) => PluggyConnectorClient
  // Serviço singleton (D31) repassado a todo cliente construído — é quem o override de `getApiKey`
  // chama pra gravar `AUTH`. Opcional só para não quebrar teste que não usa registro de chamadas.
  pluggyCallRecorder?: PluggyCallRecorder
}

// Substituiu o `PluggyAuthGateway`: `POST /auth`, o cache da api key e a renovação por expiração do
// JWT são do `pluggy-sdk` (`BaseApi.getApiKey`), não nossos (padroes-de-engenharia, 3b). O que sobra
// aqui, e é a razão desta classe existir, é o **ciclo de vida** do cliente.
//
// Um cliente por `clientId`, cacheado. O SDK guarda a api key **dentro da instância**, então um
// cliente novo por chamada re-autenticaria toda vez e queimaria a cota mensal do plano gratuito
// (fronteira-pluggy, regra 6). Por isso esta classe é registrada como `singleton`: o cache precisa
// sobreviver ao escopo da unidade de trabalho, senão cada evento de webhook paga um `/auth`.
//
// A chave do cache é o `clientId`, o que também é o que mantém as três contas do agregado familiar
// isoladas (arquitetura-camadas, seção 4): nenhuma api key de uma pessoa é reaproveitada para outra.
// O `clientSecret` não entra na chave — `clientId` já identifica a credencial, e pôr segredo em
// chave de Map é só espalhá-lo por mais um lugar.
export function shouldSuppressSdkLog(args: unknown[]): boolean {
  return typeof args[0] === 'string' && args[0].startsWith('[Pluggy SDK]')
}

let sdkConsoleFilterInstalled = false

export function installSdkConsoleFilter(targetConsole = console): void {
  if (targetConsole === console && sdkConsoleFilterInstalled) {
    return
  }
  const originalError = targetConsole.error
  targetConsole.error = (...args: unknown[]) => {
    if (shouldSuppressSdkLog(args)) {
      // O BaseApi do SDK imprime error.response.body diretamente no console.error em caso de HTTPError.
      // Suprimimos essa emissão bruta para evitar vazamento de dados de conta/transações no stderr;
      // os gateways tratam o erro capturado através do Logger seguro com allowlist estrita.
      return
    }
    originalError.apply(targetConsole, args)
  }
  if (targetConsole === console) {
    sdkConsoleFilterInstalled = true
  }
}

export class PluggyClientGateway {
  private readonly createClient: (clientId: string, clientSecret: string) => PluggyConnectorClient
  private readonly pluggyCallRecorder: PluggyCallRecorder | undefined
  private readonly clients = new Map<string, PluggyConnectorClient>()

  constructor(params: PluggyClientGatewayParams = {}) {
    installSdkConsoleFilter()
    this.createClient =
      params.createClient ?? ((clientId, clientSecret) => new PluggyConnectorClient({ clientId, clientSecret }))
    this.pluggyCallRecorder = params.pluggyCallRecorder
  }

  // Não faz I/O: construir o cliente é barato e a autenticação acontece de forma preguiçosa, na
  // primeira chamada de dado que ele receber.
  clientFor(clientId: string, clientSecret: string): PluggyConnectorClient {
    const cached = this.clients.get(clientId)
    if (cached) {
      return cached
    }

    const client = this.createClient(clientId, clientSecret)
    if (this.pluggyCallRecorder) {
      client.setCallRecorder(this.pluggyCallRecorder)
    }
    this.clients.set(clientId, client)
    return client
  }

  // Cria cliente novo fora do cache. Essencial para validação no cadastro de credencial: garante
  // que o clientSecret recém-fornecido seja de fato testado no POST /auth, em vez de reaproveitar
  // um cliente previamente autenticado com o mesmo clientId.
  createFreshClient(clientId: string, clientSecret: string): PluggyConnectorClient {
    const client = this.createClient(clientId, clientSecret)
    if (this.pluggyCallRecorder) {
      client.setCallRecorder(this.pluggyCallRecorder)
    }
    return client
  }
}

// Tradução de falha do SDK para recusa nomeada nossa. Fica aqui, no arquivo da fronteira do SDK,
// porque é a única coisa que precisa conhecer as TRÊS formas de rejeição que o `BaseApi` produz —
// nenhum gateway de borda deve repetir esse conhecimento.
//
// 1. Erro HTTP numa chamada de dado: `createGetRequest` captura o `HTTPError` do got e rejeita com
//    `error.response.body`, um **objeto puro** — o status HTTP é perdido (padroes-de-engenharia,
//    3b.1). Sobra o `code`/`message` do corpo de erro da Pluggy, quando ela os manda.
// 2. Erro HTTP no `POST /auth`: `getApiKey` NÃO passa por aquele try/catch, então o `HTTPError` do got
//    sobe inteiro — e aí o status existe, em `response.statusCode`.
// 3. Timeout e falha de rede: sobem como `Error` do got, com `name` `TimeoutError`/`RequestError`.
export interface PluggySdkErrorTypes {
  timeout: string
  unavailable: string
  upstream: string
  // `errorType` específico por código, quando o caso merece nome próprio (ex.: 404 do item).
  // O código vem do status HTTP se ele sobreviveu (forma 2) ou do `code` do corpo de erro da Pluggy
  // (forma 1) — os dois carregam o mesmo número, e é a única pista que resta na forma 1.
  byCode?: Record<number, string>
}

export function pluggySdkError(
  error: unknown,
  errorTypes: PluggySdkErrorTypes,
  details: Record<string, unknown> = {},
): ApplicationError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new ApplicationError(errorTypes.timeout, details)
  }

  const status = statusOf(error)
  const body = errorBodyOf(error)
  const code = status ?? (typeof body?.code === 'number' ? body.code : undefined)

  const named = code !== undefined ? errorTypes.byCode?.[code] : undefined
  if (named !== undefined) {
    return new ApplicationError(named, details)
  }

  if (status !== undefined) {
    return new ApplicationError(errorTypes.upstream, { ...details, status })
  }

  if (body !== undefined) {
    // O status foi engolido pelo SDK; `code`/`message` do corpo são o que restou do diagnóstico.
    return new ApplicationError(errorTypes.upstream, {
      ...details,
      ...(typeof body.code === 'number' || typeof body.code === 'string' ? { pluggyCode: body.code } : {}),
      ...(typeof body.message === 'string' ? { pluggyMessage: body.message } : {}),
    })
  }

  return new ApplicationError(errorTypes.unavailable, details)
}

// Mesma taxonomia de `pluggySdkError` (D24: "reaproveitar, não reinventar"), mas devolvendo a
// classificação para `radar_pluggy_calls` em vez de uma `ApplicationError` de negócio — as duas
// nascem do mesmo formato de rejeição do `got` (timeout, HTTPError com status, corpo puro sem
// status). 4xx é erro do cliente (credencial/parâmetro); 5xx ou corpo sem status é falha do lado da
// Pluggy; nem timeout nem corpo/status reconhecível é indisponibilidade de rede.
export function classifyPluggyCallFailure(error: unknown): {
  failureKind: PluggyCallFailureKind
  httpStatus: number | undefined
  errorCode: string | undefined
} {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { failureKind: 'TIMEOUT', httpStatus: undefined, errorCode: undefined }
  }

  const status = statusOf(error)
  const body = errorBodyOf(error)
  const errorCode =
    typeof body?.code === 'number' || typeof body?.code === 'string' ? String(body.code) : undefined

  if (status !== undefined) {
    return { failureKind: status >= 400 && status < 500 ? 'CLIENT_ERROR' : 'UPSTREAM_ERROR', httpStatus: status, errorCode }
  }
  if (body !== undefined) {
    return { failureKind: 'UPSTREAM_ERROR', httpStatus: undefined, errorCode }
  }
  return { failureKind: error instanceof Error ? 'UNAVAILABLE' : 'UNKNOWN', httpStatus: undefined, errorCode: undefined }
}

// Corpo de erro da Pluggy rejeitado como objeto puro (forma 1). Um `Error` do got não é isso — ele
// cai no ramo de status ou no de indisponibilidade.
function errorBodyOf(error: unknown): { code?: unknown; message?: unknown } | undefined {
  if (typeof error !== 'object' || error === null || error instanceof Error) {
    return undefined
  }
  return error as { code?: unknown; message?: unknown }
}

// Status HTTP quando ele sobreviveu (forma 2). `unknown` navegado à mão porque o `HTTPError` do got
// não é importável sem acoplar este arquivo à versão do got que o SDK traz por dentro.
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null) {
    return undefined
  }
  const statusCode = (response as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

// Aceita as duas formas que um campo de data pode ter depois do `deserializeJSONWithDates`
// (padroes-de-engenharia, 3b.1): `Date` quando a string tinha milissegundo, `string` quando não.
// Ausente é ausente; presente e ilegível é recusa nomeada, nunca `undefined` em silêncio.
export function toDateOrUndefined(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }
  return undefined
}

// Forma ISO da data, para os DTOs que trafegam a data como string até a fronteira do domínio.
export function toIsoStringOrUndefined(value: unknown): string | undefined {
  return toDateOrUndefined(value)?.toISOString()
}
