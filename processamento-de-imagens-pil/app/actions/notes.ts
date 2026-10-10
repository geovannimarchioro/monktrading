'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { dayNotes } from '@/lib/db/schema'
import { getUserId } from '@/lib/session'
import { type ActionResult, failure, readDate, readText } from '@/lib/form-utils'

export async function saveDayNote(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getUserId()
    const noteDate = readDate(formData, 'noteDate')
    if (!noteDate) return { ok: false, error: 'Data inválida.' }
    const content = readText(formData, 'content', 8000)

    await db
      .insert(dayNotes)
      .values({ userId, noteDate, content })
      .onConflictDoUpdate({
        target: [dayNotes.userId, dayNotes.noteDate],
        set: { content, updatedAt: new Date() },
      })
    revalidatePath('/calendario')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Não foi possível salvar a anotação.')
  }
}
