import fs from 'node:fs'

const path = 'src/modules/obligations/obligations.service.ts'
let s = fs.readFileSync(path, 'utf8')

const lockEnd = `  private async lockAccounts(t: Prisma.TransactionClient, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (unique.length)
      await t.$queryRaw\`SELECT id FROM financial_accounts WHERE id IN (\${Prisma.join(unique.map((id) => Prisma.sql\`\${id}::uuid\`))}) ORDER BY id FOR UPDATE\`;
  }
`
const helpers = `${lockEnd}  private async applyPaymentSource(
    t: Prisma.TransactionClient,
    account: {
      id: string;
      type: string;
      nature: string;
      currentBalance: Prisma.Decimal;
      creditLimit: Prisma.Decimal | null;
    },
    amount: Prisma.Decimal,
  ) {
    if (account.type === "CREDIT_CARD") {
      if (!account.creditLimit || account.currentBalance.plus(amount).gt(account.creditLimit))
        throw new ConflictError(
          "Cupo insuficiente",
          "La tarjeta no tiene cupo suficiente para registrar este pago.",
        );
      await t.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: amount } },
      });
      return;
    }
    if (account.nature !== "ASSET") throw new NotFoundError("Cuenta pagadora no encontrada");
    await t.financialAccount.update({
      where: { id: account.id },
      data: { currentBalance: { decrement: amount } },
    });
  }
  private async restorePaymentSource(
    t: Prisma.TransactionClient,
    account: { id: string; type: string },
    amount: Prisma.Decimal,
  ) {
    await t.financialAccount.update({
      where: { id: account.id },
      data: {
        currentBalance:
          account.type === "CREDIT_CARD" ? { decrement: amount } : { increment: amount },
      },
    });
  }
`
if (!s.includes(lockEnd)) throw new Error('No se encontró lockAccounts')
s = s.replace(lockEnd, helpers)

s = s.replaceAll('orderBy: { dueDate: "asc" },', 'orderBy: { dueDate: "desc" },')

const oldPayLookup = `      const a = await t.financialAccount.findFirst({
        where: {
          id: input.accountId,
          workspaceId: w,
          nature: "ASSET",
          isActive: true,
          deletedAt: null,
        },
      });`
const newPayLookup = `      const a = await t.financialAccount.findFirst({
        where: {
          id: input.accountId,
          workspaceId: w,
          isActive: true,
          deletedAt: null,
          OR: [{ nature: "ASSET" }, { type: "CREDIT_CARD", nature: "LIABILITY" }],
        },
      });`
if (!s.includes(oldPayLookup)) throw new Error('No se encontró lookup de pay')
s = s.replace(oldPayLookup, newPayLookup)

const oldPayBalance = `      await t.financialAccount.update({
        where: { id: a.id },
        data: { currentBalance: { decrement: amount } },
      });`
if (!s.includes(oldPayBalance)) throw new Error('No se encontró actualización de saldo pay')
s = s.replace(oldPayBalance, `      await this.applyPaymentSource(t, a, amount);`)

const oldUpdateBlock = `      const accountId = input.accountId ?? current.accountId;
      await this.lockAccounts(t, [current.accountId, accountId]);
      const account = await t.financialAccount.findFirst({
        where: { id: accountId, workspaceId: w, isActive: true, deletedAt: null, nature: "ASSET" },
      });
      if (!account) throw new NotFoundError("Cuenta activa no encontrada");
      if (account.currency !== current.occurrence.obligation.currency)
        throw new ConflictError("Moneda incompatible");`
const newUpdateBlock = `      const accountId = input.accountId ?? current.accountId;
      await this.lockAccounts(t, [current.accountId, accountId]);
      const [currentAccount, account] = await Promise.all([
        t.financialAccount.findFirst({ where: { id: current.accountId, workspaceId: w } }),
        t.financialAccount.findFirst({
          where: {
            id: accountId,
            workspaceId: w,
            isActive: true,
            deletedAt: null,
            OR: [{ nature: "ASSET" }, { type: "CREDIT_CARD", nature: "LIABILITY" }],
          },
        }),
      ]);
      if (!currentAccount || !account) throw new NotFoundError("Cuenta o tarjeta activa no encontrada");
      if (account.currency !== current.occurrence.obligation.currency)
        throw new ConflictError("Moneda incompatible");`
if (!s.includes(oldUpdateBlock)) throw new Error('No se encontró bloque updatePayment')
s = s.replace(oldUpdateBlock, newUpdateBlock)

const oldUpdateBalances = `      await t.financialAccount.update({
        where: { id: current.accountId },
        data: { currentBalance: { increment: current.amount } },
      });
      await t.financialAccount.update({
        where: { id: accountId },
        data: { currentBalance: { decrement: amount } },
      });`
const newUpdateBalances = `      await this.restorePaymentSource(t, currentAccount, current.amount);
      const accountAfterRestore = await t.financialAccount.findFirstOrThrow({
        where: { id: accountId, workspaceId: w },
      });
      await this.applyPaymentSource(t, accountAfterRestore, amount);`
if (!s.includes(oldUpdateBalances)) throw new Error('No se encontró ajuste de saldos updatePayment')
s = s.replace(oldUpdateBalances, newUpdateBalances)

const oldReverse = `      await this.lockAccounts(t, [current.accountId]);
      await t.financialAccount.update({
        where: { id: current.accountId },
        data: { currentBalance: { increment: current.amount } },
      });`
const newReverse = `      await this.lockAccounts(t, [current.accountId]);
      const sourceAccount = await t.financialAccount.findFirst({
        where: { id: current.accountId, workspaceId: w },
      });
      if (!sourceAccount) throw new NotFoundError("Cuenta pagadora no encontrada");
      await this.restorePaymentSource(t, sourceAccount, current.amount);`
if (!s.includes(oldReverse)) throw new Error('No se encontró reversión de saldo')
s = s.replace(oldReverse, newReverse)

fs.writeFileSync(path, s)

const testPath = 'tests/integration/phase9.test.ts'
let test = fs.readFileSync(testPath, 'utf8')
const marker = `    expect(nextOccurrence).toMatchObject({
      status: "PENDING",
      amount: new Prisma.Decimal("80000"),
    });`
const addition = `${marker}
    const cardBeforeObligation = await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } });
    const paidWithCard = await request(app)
      .post(url(\`/obligations/\${obligation}/occurrences/\${nextOccurrence.id}/payments\`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: card,
        amount: "80000",
        occurredAt: "2026-09-15T12:00:00Z",
        idempotencyKey: \`obl-card-\${suffix}\`,
      });
    expect(paidWithCard.status).toBe(201);
    const cardAfterObligation = await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } });
    expect(cardAfterObligation.currentBalance.eq(cardBeforeObligation.currentBalance.plus("80000"))).toBe(true);
    const cardPayment = await prisma.obligationPayment.findFirstOrThrow({
      where: { occurrenceId: nextOccurrence.id, accountId: card, reversedAt: null },
    });
    const reversedCardPayment = await request(app)
      .post(url(\`/obligations/\${obligation}/payments/\${cardPayment.id}/reverse\`))
      .set(auth(actors[0]!.token))
      .send({ reason: "Prueba de reversión con tarjeta", version: cardPayment.version });
    expect(reversedCardPayment.status).toBe(200);
    const cardAfterReverse = await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } });
    expect(cardAfterReverse.currentBalance.eq(cardBeforeObligation.currentBalance)).toBe(true);`
if (!test.includes(marker)) throw new Error('No se encontró punto de prueba de obligación')
test = test.replace(marker, addition)
fs.writeFileSync(testPath, test)
