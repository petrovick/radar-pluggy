import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Único ponto de entrada externo da leitura de estado de configuração (design.md,
// expor-status-credencial-pluggy). Só traduz request/response HTTP — a checagem em si mora no
// interactor resolvido do escopo, que já existia sem rota (check-pluggy-credential.interactor.ts).
//
// `personId` nunca vem do corpo/query — vem de `req.personId`, resolvido pelo middleware de
// autenticação a partir do JWT, mesma fronteira de `registerPluggyCredentialHandler`.
//
// O interactor nomeia dois errorTypes de ausência de negócio ("ainda não configurou") e usa um
// terceiro (`PLUGGY_CREDENTIAL_CHECK_FAILED`) para embrulhar falha inesperada do gateway (ex.:
// banco fora do ar). Só os dois primeiros viram `hasCredential: false` — tratar o terceiro do
// mesmo jeito faria uma falha de infraestrutura parecer "titular sem credencial" para todo mundo,
// em 200, sem log de erro visível na resposta (achado do engenheiro-radar-pluggy).
const BUSINESS_ABSENCE_ERROR_TYPES = new Set([
  'PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON',
  'PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON',
])

export async function checkPluggyCredentialHandler(
  req: AuthenticatedRequest & ScopedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      // Nunca deveria acontecer com o middleware de autenticação e o de escopo na frente
      // (http-server.ts) — mesma recusa nomeada usada em registerPluggyCredentialHandler.
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const interactor = req.container.resolve('checkPluggyCredentialInteractor')
    const { data, error } = await interactor.execute({ personId: req.personId })

    if (error && !BUSINESS_ABSENCE_ERROR_TYPES.has(error.errorType)) {
      res.status(500).json({ errorType: error.errorType, extras: error.details })
      return
    }

    // As duas ausências de negócio nunca viram erro HTTP. O front só precisa do booleano para
    // decidir visibilidade de menu (design.md D2/D3): não repassamos `errorType` nesse caso.
    res.status(200).json({ hasCredential: data !== undefined })
  } catch {
    // O interactor já traduz erro em `{error}`; cair aqui é falha do próprio wiring/resolução.
    res.status(500).json({ errorType: 'PLUGGY_CREDENTIAL_STATUS_CHECK_FAILED' })
  }
}
