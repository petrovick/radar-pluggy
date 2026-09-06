// Superfície que todo gateway de caso de uso expõe ao interactor, além dos métodos do próprio caso de
// uso — mesma interface `DefaultGateway` do `oplab-radar-api` (`interactors/default/default-gateway.ts`).
// O interactor loga através do gateway; nunca importa logger, nunca conhece a implementação.
export interface DefaultGateway {
  addContext(context: Record<string, unknown>): void
  logInfo(message: string, extra?: unknown): void
  logWarn(message: string, extra?: unknown): void
  logError(message: string, extra?: unknown): void
}
