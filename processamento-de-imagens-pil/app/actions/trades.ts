'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { del, put } from '@vercel/blob'
import { db } from '@/lib/db'
import { tradingAccounts, trades } from '@/lib/db/schema'
import { getUserId } from '@/lib/session'
import { MAX_SCREENSHOT_BYTES } from '@/lib/constants'
import {
  type ActionResult,
  failure,
  readDate,
  readId,
  readNumber,
  readOptionalText,
  readText,
} from '@/lib/form-utils'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

async function uploadScreenshot(userId: string, file: File) {
  const ext = file.type.split('/')[1] ?? 'png'
  const blob = await put(`trades/${userId}/${Date.now()}.${ext}`, file, {
    access: 'private',
    addRandomSuffix: true,
    contentType: file.type,
  })
  return blob.pathname
}

export async function saveTrade(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const id = readId(formData, 'id')
    const accountId = readId(formData, 'accountId')
    const tradeDate = readDate(formData, 'tradeDate')
    const symbol = readText(formData, 'symbol', 20).toUpperCase()
    const pnl = readNumber(formData, 'pnl')
    const direction = readText(formData, 'direction') === 'venda' ? 'venda' : 'compra'

    if (!accountId) return { ok: false, error: 'Selecione a conta do trade.' }
    if (!tradeDate) return { ok: false, error: 'Informe uma data válida.' }
    if (!symbol) return { ok: false, error: 'Informe o ativo.' }
    if (pnl === null) return { ok: false, error: 'Informe o resultado do trade.' }

    const [owned] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
      .limit(1)
    if (!owned) return { ok: false, error: 'Conta inválida.' }

    const risk = readNumber(formData, 'risk')
    const lots = readNumber(formData, 'lots')
    const values = {
      accountId,
      tradeDate,
      symbol,
      direction,
      pnl,
      risk: risk !== null && risk > 0 ? Math.abs(risk) : null,
      lots: lots !== null && lots > 0 ? lots : null,
      setup: readOptionalText(formData, 'setup', 80),
      notes: readOptionalText(formData, 'notes', 4000),
    }

    const file = formData.get('screenshot')
    let newScreenshot: string | undefined
    if (file instanceof File && file.size > 0) {
      if (!IMAGE_TYPES.includes(file.type)) {
        return { ok: false, error: 'O print precisa ser PNG, JPG, WEBP ou GIF.' }
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        return { ok: false, error: 'O print deve ter no máximo 4 MB.' }
      }
      newScreenshot = await uploadScreenshot(userId, file)
    }
    const removeScreenshot = readText(formData, 'removeScreenshot') === '1'

    if (id) {
      const [existing] = await db
        .select({ screenshot: trades.screenshot })
        .from(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, userId)))
        .limit(1)
      if (!existing) return { ok: false, error: 'Trade não encontrado.' }

      const screenshot = newScreenshot ?? (removeScreenshot ? null : existing.screenshot)
      await db
        .update(trades)
        .set({ ...values, screenshot })
        .where(and(eq(trades.id, id), eq(trades.userId, userId)))

      if (existing.screenshot && existing.screenshot !== screenshot) {
        await del(existing.screenshot).catch((e) => console.error('[blob]', e))
      }
    } else {
      await db.insert(trades).values({ ...values, userId, screenshot: newScreenshot ?? null })
    }

    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível salvar o trade.')
  }
}

export async function deleteTrade(id: number): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const [removed] = await db
      .delete(trades)
      .where(and(eq(trades.id, id), eq(trades.userId, userId)))
      .returning({ screenshot: trades.screenshot })
    if (removed?.screenshot) {
      await del(removed.screenshot).catch((e) => console.error('[blob]', e))
    }
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível excluir o trade.')
  }
}
