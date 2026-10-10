'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { cashFlows, tradingAccounts } from '@/lib/db/schema'
import { getUserId } from '@/lib/session'
import { CASH_FLOW_KINDS } from '@/lib/constants'
import {
  type ActionResult,
  failure,
  oneOf,
  readDate,
  readId,
  readNumber,
  readOptionalText,
  readText,
} from '@/lib/form-utils'

export async function createCashFlow(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const accountId = readId(formData, 'accountId')
    const kind = oneOf(readText(formData, 'kind'), CASH_FLOW_KINDS)
    const flowDate = readDate(formData, 'flowDate')
    const amount = readNumber(formData, 'amount')

    if (!accountId) return { ok: false, error: 'Selecione a conta.' }
    if (!kind) return { ok: false, error: 'Selecione o tipo de movimentação.' }
    if (!flowDate) return { ok: false, error: 'Informe uma data válida.' }
    if (amount === null || amount <= 0) return { ok: false, error: 'Informe um valor positivo.' }

    const [owned] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
      .limit(1)
    if (!owned) return { ok: false, error: 'Conta inválida.' }

    await db.insert(cashFlows).values({
      userId,
      accountId,
      kind,
      flowDate,
      amount,
      description: readOptionalText(formData, 'description', 200),
    })
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível salvar a movimentação.')
  }
}

export async function deleteCashFlow(id: number): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    await db.delete(cashFlows).where(and(eq(cashFlows.id, id), eq(cashFlows.userId, userId)))
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível excluir a movimentação.')
  }
}
