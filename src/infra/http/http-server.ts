import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { registerPluggyCredentialHandler } from '../../adapters/handlers/register-pluggy-credential.handler.js'
import { createAuthenticateMiddleware } from './middleware/authenticate.middleware.js'
import { createRequestScopeMiddleware } from './middleware/request-scope.middleware.js'
import type { AppContainerInstance } from '../bootstrap/register.js'
import { loadPluggyHistoryHandler } from '../../adapters/handlers/load-pluggy-history.handler.js'
import { createPluggyWebhookHandler } from '../../adapters/handlers/pluggy-webhook.handler.js'
import { reconcilePluggyWebhookHandler } from '../../adapters/handlers/reconcile-pluggy-webhook.handler.js'
import { checkHealthHandler } from '../../adapters/handlers/health.handler.js'
import { drainInBackground } from '../worker/webhook-drainer.js'

export interface HttpServerDependencies {
  jwtSecret: string
  container: AppContainerInstance
}

// Composition root do Express — mora em `infra/http/`, mesmo agrupamento do `oplab-radar-api`
// (`http-server.ts` + `middleware/` + `routes/`, aqui sem `routes/` porque a rota é montada direto
// neste arquivo). Toda rota autenticada fica atrás do middleware de autenticação — `personId`
// nunca chega por outro caminho que não seja o JWT verificado. Nenhum caso de uso é montado à mão
// aqui: todos saem do escopo da requisição.
export function createHttpServer(deps: HttpServerDependencies): Express {
  const app = express()
  app.use(express.json())

  const authenticate = createAuthenticateMiddleware(deps.jwtSecret)
  // Escopo de container por request, antes de qualquer rota: é dele que sai a transação, o logger e
  // os casos de uso daquela unidade de trabalho — inclusive os que o middleware de autenticação usa.
  app.use(createRequestScopeMiddleware(deps.container))

  // Sem JWT: é a plataforma (Railway) quem chama, não um titular — `.railway/railway.ts` →
  // `healthcheck`.
  app.get('/healthcheck', checkHealthHandler)

  app.post('/credentials', authenticate, registerPluggyCredentialHandler)

  // Carga histórica manual, só por decisão explícita do titular (tasks.md 6.3).
  app.post('/items/:itemId/history/load', authenticate, loadPluggyHistoryHandler)

  // Webhook da Pluggy: sem JWT (quem autentica é o segredo de entrada da credencial, comparado
  // em tempo constante), responde 2xx com o evento já persistido e drena depois da resposta.
  app.post(
    '/webhooks/pluggy',
    createPluggyWebhookHandler(deps.container, (container) =>
      drainInBackground(container, (error) => {
        container.resolve('logger').error('falha ao drenar webhook', { err: error })
      }),
    ),
  )

  // Provisionar/corrigir webhook de credencial já cadastrada — decisão explícita do titular.
  app.post('/webhooks/pluggy/reconcile', authenticate, reconcilePluggyWebhookHandler)

  // Fronteira de erro do próprio Express: `express.json()` lança antes de qualquer rota ou
  // middleware de aplicação rodar quando o corpo não é JSON válido — sem isto, o handler padrão do
  // Express responde HTML com stack trace completo (caminho absoluto do servidor incluído),
  // quebrando o contrato {errorType, extras} que o oplab-radar-front espera de todo endpoint
  // (achado do engenheiro-pluggy-connector). Precisa de 4 parâmetros e vir por último — é assim que
  // o Express reconhece middleware de erro.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err)
      return
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ errorType: 'PLUGGY_CONNECTOR_MALFORMED_JSON' })
      return
    }
    res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  return app
}
