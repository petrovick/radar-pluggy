import type { PluggyConnectorClient } from '../../../src/adapters/gateways/pluggy-client.gateway.js'

// Fake do cliente do SDK, e não da URL: o `baseUrl` do `ClientParams` é declarado e ignorado pelo
// `BaseApi` (padroes-de-engenharia, 3b.1), então não existe jeito de apontar o SDK para um servidor
// de teste por instância. Fingir o cliente é o único caminho — e é o melhor: o teste passa a exercitar
// a validação e a tradução, que é o que sobrou de nosso nestes gateways.
export function fakePluggyClient(methods: Record<string, unknown>): PluggyConnectorClient {
  return methods as unknown as PluggyConnectorClient
}

// Falha HTTP numa chamada de dado, do jeito que o SDK a entrega: `createGetRequest` captura o
// `HTTPError` do got e rejeita com `error.response.body` — um objeto puro, sem status e sem ser um
// `Error`. O `code` do corpo é o que resta para distinguir 404 de 500.
export function pluggySdkHttpError(code: number, message = 'erro da Pluggy'): unknown {
  return { code, message }
}

// Falha HTTP no `POST /auth`: `getApiKey` não passa pelo try/catch do `createGetRequest`, então o
// `HTTPError` do got sobe inteiro e o status HTTP sobrevive em `response.statusCode`.
export function pluggySdkAuthError(statusCode: number): Error {
  return Object.assign(new Error('falha de autenticação'), { response: { statusCode } })
}

// Timeout e falha de rede: o SDK não os embrulha, então chegam como `Error` do got.
export function pluggySdkTimeout(): Error {
  return Object.assign(new Error('timeout'), { name: 'TimeoutError' })
}

export function pluggySdkNetworkFailure(): Error {
  return Object.assign(new Error('conexão recusada'), { name: 'RequestError' })
}
