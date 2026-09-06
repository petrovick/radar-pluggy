import { Console } from 'node:console'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  PluggyClientGateway,
  PluggyConnectorClient,
  installSdkConsoleFilter,
  shouldSuppressSdkLog,
  pluggySdkError,
} from '../../../src/adapters/gateways/pluggy-client.gateway.js'

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
})
