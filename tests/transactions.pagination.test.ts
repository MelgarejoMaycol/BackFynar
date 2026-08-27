import { describe, expect, it, vi } from 'vitest'
import { TransactionsRepository } from '../src/modules/transactions/transactions.repository.js'

describe('paginación estable de movimientos', () => {
  it('ordena por fecha real, creación e id y solicita un registro adicional', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const database = { transaction: { findMany, count: vi.fn().mockResolvedValue(0) } }
    const repository = new TransactionsRepository(database as never)
    await repository.list('workspace', { limit: 20 } as never)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    }))
  })

  it('aplica el cursor compuesto sin offset', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const database = { transaction: { findMany, count: vi.fn().mockResolvedValue(0) } }
    const repository = new TransactionsRepository(database as never)
    const cursor = Buffer.from(JSON.stringify({ occurredAt: '2026-08-20T16:00:00.200Z', createdAt: '2026-08-20T16:00:01Z', id: 'b' })).toString('base64url')
    await repository.list('workspace', { limit: 20, cursor } as never)
    const options = findMany.mock.calls[0]![0]
    expect(options).not.toHaveProperty('skip')
    expect(options.where.AND[1].OR).toHaveLength(3)
  })
})
