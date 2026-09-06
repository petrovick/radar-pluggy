// Ciclo de transação do gateway de caso de uso — mesma interface do `oplab-radar-api`
// (`interactors/default/default-interactor.types.ts`). Quem chama estes métodos é o **impl** do
// gateway, nunca o interactor: o caso de uso não sabe que existe transação (ver `arquitetura-camadas`,
// regra 2). Estão declarados nesta camada só para o impl ter um contrato nomeado a implementar.
export interface DefaultInteractorGateway {
  startProcess(): Promise<void>
  storeProcess(): Promise<void>
  terminateProcess(): Promise<void>
  cancelProcess(): Promise<void>
}
