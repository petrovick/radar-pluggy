import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/health/check-health.impl.ts`. O ator é a própria
// plataforma (Railway, `railway.json` → `healthcheckPath`), que pergunta "este processo está de pé
// e alcança o banco?" — não confirma nada de negócio além disso.

export interface CheckHealthGateway extends DefaultGateway {
  checkDatabaseConnection(): Promise<void>
}

export type CheckHealthResult = { running: true }

export type CheckHealthOutput = {
  data?: CheckHealthResult
  error?: ApplicationError
}
