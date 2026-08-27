import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { CardsService } from '../src/modules/cards/cards.service.js'

describe('adelanto de tarjeta', () => {
  it('crea una sola transacción y aplica exactamente un crédito y una deuda', async () => {
    const transactionCreate = vi.fn().mockResolvedValue({ id: 'transaction-1' })
    const accountUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: transactionCreate,
      },
      financialAccount: {
        findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.type === 'CREDIT_CARD'
            ? { id: 'card', name: 'Credi Tarjeta', type: 'CREDIT_CARD', nature: 'LIABILITY', currency: 'COP', currentBalance: new Prisma.Decimal('100000'), creditLimit: new Prisma.Decimal('1500000'), referencePeriodicRate: null, referenceRateSource: null }
            : { id: 'nequi', nature: 'ASSET', currency: 'COP', currentBalance: new Prisma.Decimal('300000') },
        )),
        update: accountUpdate,
      },
      cardCashAdvance: { create: vi.fn().mockResolvedValue({ id: 'advance-1' }) },
    }
    const db = { $transaction: vi.fn((operation) => operation(tx)) }
    const service = new CardsService(db as never)
    const result = await service.cashAdvance('workspace', 'user', 'card', {
      destinationAccountId: 'nequi', amount: '200000', feeAmount: '0',
      occurredAt: '2026-08-20T16:00:00.000Z', idempotencyKey: 'advance-test-1',
    })
    expect(result.transactionId).toBe('transaction-1')
    expect(transactionCreate).toHaveBeenCalledTimes(1)
    expect(transactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: { cardCashAdvance: true, feeAmount: '0.00' } }) }))
    expect(accountUpdate).toHaveBeenCalledTimes(2)
    expect(accountUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'card' }, data: { currentBalance: { increment: new Prisma.Decimal('200000') } } })
    expect(accountUpdate).toHaveBeenNthCalledWith(2, { where: { id: 'nequi' }, data: { currentBalance: { increment: new Prisma.Decimal('200000') } } })
  })
})
