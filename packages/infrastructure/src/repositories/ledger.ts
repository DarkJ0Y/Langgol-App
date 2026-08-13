/**
 * Ledger posting.
 *
 * One function matters here: `postJournal`. It writes a balanced transaction and its entries in a
 * single database transaction, creating owner accounts lazily, and it is **idempotent by
 * construction** — the unique constraint on `idempotencyKey` means a journal derived from the
 * same business event can only ever land once, no matter how many times the caller retries.
 *
 * The domain has already refused to build an unbalanced journal, and the database will refuse to
 * commit one via a deferred constraint trigger. This layer simply does not get a vote.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §3, §7, §13
 */

import { prisma } from '@langgol/db'
import { accountDefinition, type Journal } from '@langgol/domain/ledger'
import * as Money from '@langgol/domain/money'

export interface PostedTransaction {
  readonly transactionId: string
  /** True when this exact journal had already been posted and nothing new was written. */
  readonly alreadyPosted: boolean
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Find or create the account for a (code, ownerId) pair.
 *
 * Per-farmer and per-agent accounts are created lazily rather than provisioned up front, because
 * the platform does not know its farmers in advance. The unique index on `(code, ownerId)` makes
 * the race between two concurrent creations resolve to one row.
 */
async function resolveAccount(
  tx: Tx,
  code: string,
  ownerType: string,
  ownerId: string | null,
): Promise<string> {
  const definition = accountDefinition(code)
  if (!definition) {
    throw new Error(
      `Account code "${code}" is not in the chart of accounts. Add it to CHART_OF_ACCOUNTS ` +
        'before posting to it — an ad-hoc account is an unreconcilable account.',
    )
  }

  const existing = await tx.ledgerAccount.findFirst({ where: { code, ownerId } })
  if (existing) return existing.id

  const created = await tx.ledgerAccount.create({
    data: {
      code,
      name: definition.name,
      type: definition.type as 'ASSET',
      ownerType: ownerType as 'PLATFORM',
      ownerId,
    },
    select: { id: true },
  })
  return created.id
}

/**
 * Post a journal.
 *
 * Returns `alreadyPosted: true` rather than throwing on a replay, because a retried delivery
 * confirmation is normal operation on this network — not an error the caller should have to
 * distinguish from a real failure.
 */
export async function postJournal(
  journal: Journal,
  reference?: { readonly type: string; readonly id: string },
): Promise<PostedTransaction> {
  const existing = await prisma.ledgerTransaction.findUnique({
    where: { idempotencyKey: journal.idempotencyKey },
    select: { id: true },
  })
  if (existing) return { transactionId: existing.id, alreadyPosted: true }

  try {
    return await prisma.$transaction(async (tx) => {
      const transaction = await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: journal.idempotencyKey,
          description: journal.description,
          referenceType: reference?.type ?? null,
          referenceId: reference?.id ?? null,
        },
        select: { id: true },
      })

      for (const line of journal.lines) {
        const accountId = await resolveAccount(tx, line.accountCode, line.ownerType, line.ownerId)
        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            accountId,
            direction: line.direction,
            amountPoisha: line.amountPoisha,
            memo: line.memo,
          },
        })
      }

      // The deferred balance trigger fires at COMMIT, here.
      return { transactionId: transaction.id, alreadyPosted: false }
    })
  } catch (cause) {
    // A concurrent poster won the race on the unique key. That is the constraint doing its job.
    if (cause instanceof Error && cause.message.includes('idempotency_key')) {
      const winner = await prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: journal.idempotencyKey },
        select: { id: true },
      })
      if (winner) return { transactionId: winner.id, alreadyPosted: true }
    }
    throw cause
  }
}

/**
 * Balance of one account, derived from its entries.
 *
 * **No balance is ever stored.** This is a query, every time. A cached balance is a materialised
 * view with an integrity check, never the source of truth. docs/06 §3.
 */
export async function accountBalance(code: string, ownerId: string | null = null): Promise<bigint> {
  const definition = accountDefinition(code)
  if (!definition) throw new Error(`Unknown account code "${code}"`)

  const account = await prisma.ledgerAccount.findFirst({
    where: { code, ownerId },
    select: { id: true },
  })
  if (!account) return 0n

  const sums = await prisma.ledgerEntry.groupBy({
    by: ['direction'],
    where: { accountId: account.id },
    _sum: { amountPoisha: true },
  })

  const debits = sums.find((row) => row.direction === 'DEBIT')?._sum.amountPoisha ?? 0n
  const credits = sums.find((row) => row.direction === 'CREDIT')?._sum.amountPoisha ?? 0n

  // A debit increases assets and expenses; a credit increases everything else.
  return definition.type === 'ASSET' || definition.type === 'EXPENSE'
    ? Money.subtract(debits as never, credits as never)
    : Money.subtract(credits as never, debits as never)
}

/**
 * The daily control from docs/06 §9: every transaction must balance.
 *
 * Runs against the whole ledger rather than a sample, because a single unbalanced transaction
 * invalidates every report derived from the books.
 */
export async function findUnbalancedTransactions(): Promise<
  { transactionId: string; debits: bigint; credits: bigint }[]
> {
  const rows = await prisma.$queryRaw<
    { transaction_id: string; debits: bigint; credits: bigint }[]
  >`
    SELECT transaction_id,
           COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'DEBIT'), 0)  AS debits,
           COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'CREDIT'), 0) AS credits
      FROM ledger_entries
     GROUP BY transaction_id
    HAVING COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'DEBIT'), 0)
        <> COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'CREDIT'), 0)
  `

  return rows.map((row) => ({
    transactionId: row.transaction_id,
    debits: row.debits,
    credits: row.credits,
  }))
}
