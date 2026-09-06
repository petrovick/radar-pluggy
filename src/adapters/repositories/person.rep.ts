import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PersonRow } from '../../infra/db/models/person-model.js'

// Read-only: nunca cria, atualiza nem apaga linha de `people` (fronteira-pluggy regra 13). Receber a
// bag do container não afrouxa isso — a fronteira aqui é "só leitura", e ela continua valendo.
export class PersonRep {
  private readonly model: ModelStatic<Model<PersonRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.person
    this.getTransaction = params.getTransaction
  }

  async findIdByUsername(username: string): Promise<number | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findOne({
      where: { username },
      ...(transaction ? { transaction } : {}),
    })
    return row?.get().id
  }
}
