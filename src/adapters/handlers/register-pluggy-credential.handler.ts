import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

interface RegisterPluggyCredentialBody {
  clientId?: unknown
  clientSecret?: unknown
  itemId?: unknown
}

// Único ponto de entrada externo do cadastro de credencial (design.md D7,
// configuracao-credenciais-pluggy). Só traduz request/response HTTP — a orquestração (criar
// credencial, vincular itemId) mora no interactor resolvido do escopo, não aqui. Fronteira de erro
// rígida (padroes-de-engenharia, regra 4): nunca deixa exceção escapar sem resposta HTTP controlada —
// este processo atende as três contas ao mesmo tempo (arquitetura-camadas, seção 4).
//
// `personId` nunca vem do corpo da requisição — vem de `req.personId`, resolvido pelo middleware
// de autenticação (design.md D8) a partir do JWT. Rota só é alcançável depois desse middleware
// (ver http-server.ts); `personId` sempre está definido aqui.
export async function registerPluggyCredentialHandler(
  req: AuthenticatedRequest & ScopedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      // Nunca deveria acontecer com o middleware de autenticação e o de escopo na frente
      // (http-server.ts) — recusa nomeada em vez de deixar `undefined` vazar pro interactor, que
      // tipa `personId` como obrigatório.
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const body = req.body as RegisterPluggyCredentialBody
    const interactor = req.container.resolve('registerPluggyCredentialInteractor')
    const { data, error } = await interactor.execute({
      personId: req.personId,
      clientId: toStringOrEmpty(body.clientId),
      clientSecret: toStringOrEmpty(body.clientSecret),
      itemId: toStringOrEmpty(body.itemId),
    })

    if (error) {
      // `extras`, não `details`: contrato de erro que o oplab-radar-front já lê em
      // http-client.ts (toApiError) para todo endpoint — pluggy-connector segue o mesmo
      // formato, já que o front fala direto com este serviço (design.md D7).
      res.status(400).json({ errorType: error.errorType, extras: error.details })
      return
    }

    if (!data) {
      // Sem `error` e sem `data` é estado que o interactor não produz. Recusa nomeada em vez de
      // responder 201 com `{"id": undefined}`, que o front leria como cadastro bem-sucedido sem id.
      res.status(500).json({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
      return
    }

    res.status(201).json({ id: data.credentialId })
  } catch {
    // O interactor já traduz erro em `{error}`; cair aqui é falha do próprio wiring/resolução.
    res.status(500).json({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
  }
}

// Só faz o narrowing unknown → string; não decide "vazio" — quem decide o que é campo ausente é o
// interactor/entidade, com o errorType específico de cada campo (achado do engenheiro-pluggy-connector:
// validar vazio aqui duplicava e divergia do errorType que a entidade já produz).
function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
