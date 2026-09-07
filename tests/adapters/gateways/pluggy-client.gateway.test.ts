import { Console } from 'node:console'
import { PassThrough } from 'node:stream'
import { PluggyClient } from 'pluggy-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  PluggyClientGateway,
  PluggyConnectorClient,
  installSdkConsoleFilter,
  shouldSuppressSdkLog,
  pluggySdkError,
  classifyPluggyCallFailure,
} from '../../../src/adapters/gateways/pluggy-client.gateway.js'
import type { PluggyCallRecorder, PluggyCallEvent } from '../../../src/adapters/gateways/pluggy-call-recorder.js'
import { runWithCallContext } from '../../../src/infra/tools/call-context.js'

describe('PluggyClientGateway', () => {
  it('clientFor: reaproveita a mesma instância de cliente para o mesmo clientId', () => {
    const gateway = new PluggyClientGateway({
      createClient: (clientId, clientSecret) =>
        new PluggyConnectorClient({ clientId, clientSecret }),
    })

    const client1 = gateway.clientFor('client-1', 'secret-a')
    const client2 = gateway.clientFor('client-1', 'secret-b')

    expect(client1).toBe(client2)
  })

  it('createFreshClient: constrói um novo cliente sem ler nem gravar no cache', () => {
    const gateway = new PluggyClientGateway({
      createClient: (clientId, clientSecret) =>
        new PluggyConnectorClient({ clientId, clientSecret }),
    })

    const cached = gateway.clientFor('client-1', 'secret-a')
    const fresh1 = gateway.createFreshClient('client-1', 'novo-secret-1')
    const fresh2 = gateway.createFreshClient('client-1', 'novo-secret-2')

    expect(fresh1).not.toBe(cached)
    expect(fresh2).not.toBe(fresh1)
    expect(fresh2).not.toBe(cached)
    // O cliente em cache permanece inalterado
    expect(gateway.clientFor('client-1', 'secret-a')).toBe(cached)
  })

  it('shouldSuppressSdkLog identifica chamadas de erro do Pluggy SDK', () => {
    expect(shouldSuppressSdkLog(['[Pluggy SDK] HTTP request failed: 404', { secret: '123' }])).toBe(true)
    expect(shouldSuppressSdkLog(['Erro normal da aplicação', { id: 1 }])).toBe(false)
    expect(shouldSuppressSdkLog([123])).toBe(false)
  })

  it('filtro de logs do SDK: impede que chamadas de erro do Pluggy SDK com dados brutos vazem no stderr stream', () => {
    const outStream = new PassThrough()
    const errStream = new PassThrough()
    const testConsole = new Console({ stdout: outStream, stderr: errStream })

    installSdkConsoleFilter(testConsole)

    // Simula a exata chamada interna do BaseApi do pluggy-sdk ao capturar HTTPError:
    testConsole.error('[Pluggy SDK] HTTP request failed: 404 Not Found', {
      contaBancaria: '00000000-0',
      saldoReal: 1234.56,
      detalheSensivel: 'DADO_SENSIVEL_DE_TESTE',
    })

    // Erros normais de aplicação continuam sendo gravados no stream de stderr
    testConsole.error('ERRO_NORMAL_DE_APLICACAO')

    const logged = errStream.read()?.toString() || ''
    expect(logged).not.toContain('[Pluggy SDK]')
    expect(logged).not.toContain('00000000-0')
    expect(logged).not.toContain('1234.56')
    expect(logged).not.toContain('DADO_SENSIVEL_DE_TESTE')
    expect(logged).toContain('ERRO_NORMAL_DE_APLICACAO')
  })

  it('pluggySdkError traduz timeout e upstream com detalhes controlados', () => {
    const timeoutErr = new Error('Timeout')
    timeoutErr.name = 'TimeoutError'

    const appErr = pluggySdkError(
      timeoutErr,
      {
        timeout: 'PLUGGY_TIMEOUT',
        unavailable: 'PLUGGY_UNAVAILABLE',
        upstream: 'PLUGGY_UPSTREAM_ERROR',
      },
      { itemId: 'item-1' },
    )

    expect(appErr.errorType).toBe('PLUGGY_TIMEOUT')
    expect(appErr.details).toEqual({ itemId: 'item-1' })
  })

  it('classifyPluggyCallFailure: 4xx é CLIENT_ERROR, 5xx é UPSTREAM_ERROR, timeout é TIMEOUT', () => {
    const timeoutErr = new Error('t')
    timeoutErr.name = 'TimeoutError'
    expect(classifyPluggyCallFailure(timeoutErr).failureKind).toBe('TIMEOUT')

    const clientErr = { response: { statusCode: 404 } }
    expect(classifyPluggyCallFailure(clientErr)).toMatchObject({ failureKind: 'CLIENT_ERROR', httpStatus: 404 })

    const upstreamErr = { response: { statusCode: 500 } }
    expect(classifyPluggyCallFailure(upstreamErr)).toMatchObject({ failureKind: 'UPSTREAM_ERROR', httpStatus: 500 })

    const bodyOnlyErr = { code: 502, message: 'bad gateway' }
    expect(classifyPluggyCallFailure(bodyOnlyErr)).toMatchObject({ failureKind: 'UPSTREAM_ERROR', errorCode: '502' })

    const networkErr = new Error('ECONNREFUSED')
    expect(classifyPluggyCallFailure(networkErr).failureKind).toBe('UNAVAILABLE')
  })
})

// design.md D1: autenticação observada no ponto real onde acontece, nunca simulada a partir de
// outra chamada. `getApiKey` é `protected` no SDK — o override é testado chamando-o diretamente via
// cast, mesma técnica que o próprio SDK usa internamente (`this.getApiKey()`).
describe('PluggyConnectorClient.getApiKey (D1)', () => {
  function asGetApiKey(client: PluggyConnectorClient): () => Promise<string> {
    return (client as unknown as { getApiKey(): Promise<string> }).getApiKey.bind(client)
  }

  // `getApiKey`/`isJwtExpired` são `protected` no SDK — o cast expõe só a assinatura pública que o
  // teste precisa espiar, sem recorrer a `never` (que apagaria os métodos do mock).
  const superProto = PluggyClient.prototype as unknown as {
    getApiKey(): Promise<string>
    isJwtExpired(token: string): boolean
  }

  function fakeRecorder(): { recorder: PluggyCallRecorder; events: PluggyCallEvent[] } {
    const events: PluggyCallEvent[] = []
    return { recorder: { record: (event: PluggyCallEvent) => events.push(event) } as unknown as PluggyCallRecorder, events }
  }

  it('client novo (sem token em cache) gera um registro de AUTH correspondente à autenticação real', async () => {
    const client = new PluggyConnectorClient({ clientId: 'c1', clientSecret: 's1' })
    const { recorder, events } = fakeRecorder()
    client.setCallRecorder(recorder)

    const spy = vi.spyOn(superProto, 'getApiKey').mockResolvedValue('token-abc')

    const key = await runWithCallContext({ trigger: 'WEBHOOK', requestCorrelationId: 'corr-1' }, () =>
      asGetApiKey(client)(),
    )

    expect(key).toBe('token-abc')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ operation: 'AUTH', callScope: 'AUTH', outcome: 'SUCCEEDED', trigger: 'WEBHOOK', requestCorrelationId: 'corr-1' })

    spy.mockRestore()
  })

  it('client com token em cache ainda válido não gera nenhum registro de AUTH', async () => {
    const client = new PluggyConnectorClient({ clientId: 'c1', clientSecret: 's1' })
    const { recorder, events } = fakeRecorder()
    client.setCallRecorder(recorder)
    ;(client as unknown as { apiKey: string }).apiKey = 'cached-token'
    const isJwtExpiredSpy = vi.spyOn(superProto, 'isJwtExpired').mockReturnValue(false)

    const key = await asGetApiKey(client)()

    expect(key).toBe('cached-token')
    expect(events).toEqual([])

    isJwtExpiredSpy.mockRestore()
  })

  it('falha real de autenticação gera registro FAILED com failureKind, e relança o erro original', async () => {
    const client = new PluggyConnectorClient({ clientId: 'c1', clientSecret: 's1' })
    const { recorder, events } = fakeRecorder()
    client.setCallRecorder(recorder)

    const authError = { response: { statusCode: 401 } }
    const spy = vi.spyOn(superProto, 'getApiKey').mockRejectedValue(authError)

    await expect(asGetApiKey(client)()).rejects.toBe(authError)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ operation: 'AUTH', outcome: 'FAILED', failureKind: 'CLIENT_ERROR', httpStatus: 401 })

    spy.mockRestore()
  })

  it('sem PluggyCallRecorder configurado, nunca lança — apenas não registra', async () => {
    const client = new PluggyConnectorClient({ clientId: 'c1', clientSecret: 's1' })
    const spy = vi.spyOn(superProto, 'getApiKey').mockResolvedValue('token-xyz')

    await expect(asGetApiKey(client)()).resolves.toBe('token-xyz')

    spy.mockRestore()
  })
})
