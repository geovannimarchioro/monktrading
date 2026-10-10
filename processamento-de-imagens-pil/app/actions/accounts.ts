'use server'

import { and, eq, isNotNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { del } from '@vercel/blob'
import { db } from '@/lib/db'
import { cashFlows, tradingAccounts, trades } from '@/lib/db/schema'
import { getUserId } from '@/lib/session'
import {
  ACCOUNT_COOKIE,
  ACCOUNT_KINDS,
  ACCOUNT_STATUSES,
  CURRENCIES,
} from '@/lib/constants'
import {
  type ActionResult,
  failure,
  oneOf,
  readId,
  readNumber,
  readOptionalText,
  readText,
} from '@/lib/form-utils'

function parseAccount(formData: FormData) {
  const name = readText(formData, 'name', 80)
  if (!name) return { error: 'Informe um nome para a conta.' } as const
  const kind = oneOf(readText(formData, 'kind'), ACCOUNT_KINDS) ?? 'mesa'
  const status = oneOf(readText(formData, 'status'), ACCOUNT_STATUSES) ?? 'fase1'
  const currencyRaw = readText(formData, 'currency', 3).toUpperCase()
  const currency = (CURRENCIES as readonly string[]).includes(currencyRaw) ? currencyRaw : 'USD'
  const initialBalance = readNumber(formData, 'initialBalance') ?? 0
  const positive = (v: number | null) => (v !== null && v > 0 ? v : null)

  return {
    values: {
      name,
      kind,
      status,
      currency,
      firm: readOptionalText(formData, 'firm', 80),
      initialBalance,
      profitTarget: positive(readNumber(formData, 'profitTarget')),
      maxDrawdown: positive(readNumber(formData, 'maxDrawdown')),
      dailyLossLimit: positive(readNumber(formData, 'dailyLossLimit')),
      notes: readOptionalText(formData, 'notes', 2000),
    },
  } as const
}

export async function saveAccount(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const parsed = parseAccount(formData)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    const id = readId(formData, 'id')

    if (id) {
      await db
        .update(tradingAccounts)
        .set(parsed.values)
        .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
    } else {
      await db.insert(tradingAccounts).values({ ...parsed.values, userId })
    }
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível salvar a conta.')
  }
}

export async function updateAccountStatus(id: number, status: string): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const valid = oneOf(status, ACCOUNT_STATUSES)
    if (!valid) return { ok: false, error: 'Status inválido.' }
    await db
      .update(tradingAccounts)
      .set({ status: valid })
      .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível atualizar o status.')
  }
}

export async function deleteAccount(id: number): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const owned = and(eq(trades.accountId, id), eq(trades.userId, userId))
    const shots = await db
      .select({ screenshot: trades.screenshot })
      .from(trades)
      .where(and(owned, isNotNull(trades.screenshot)))

    await db.delete(trades).where(owned)
    await db
      .delete(cashFlows)
      .where(and(eq(cashFlows.accountId, id), eq(cashFlows.userId, userId)))
    await db
      .delete(tradingAccounts)
      .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))

    const paths = shots.map((s) => s.screenshot).filter((s): s is string => !!s)
    if (paths.length > 0) await del(paths).catch((e) => console.error('[blob]', e))

    const store = await cookies()
    if (store.get(ACCOUNT_COOKIE)?.value === String(id)) store.delete(ACCOUNT_COOKIE)
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível excluir a conta.')
  }
}

export async function selectAccount(id: number | null) {
  const store = await cookies()
  if (id && Number.isInteger(id) && id > 0) {
    store.set(ACCOUNT_COOKIE, String(id), {
      path: '/',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'lax',
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
    })
  } else {
    store.delete(ACCOUNT_COOKIE)
  }
  revalidatePath('/', 'layout')
}
