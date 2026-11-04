/**
 * Purpose: A tiny toast store for task-completion feedback - a confirmation (or an
 *   error) that stays on screen after the task card that triggered it has left the
 *   list.
 * Version: v1 (2026-09-19)
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Module-level store read with useSyncExternalStore. Pushed to by
 *   schedule/mutations.useCompleteTask (mutation-level callbacks, which - unlike the
 *   per-call `mutate(..., { onSuccess })` ones - still run after the card unmounts);
 *   rendered by schedule/CompletionToasts.tsx inside ScheduleBoard. Why it exists
 *   (tracker #29): completing a task removed its card, and the "Completed" note lived
 *   inside that card, so success left no trace and a failed request showed nothing.
 */
import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((l) => l())

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function pushToast(kind: Toast['kind'], text: string) {
  const id = nextId++
  toasts = [...toasts, { id, kind, text }].slice(-5)
  emit()
  // Successes clear themselves; an error stays until it is dismissed.
  if (kind === 'ok') setTimeout(() => dismissToast(id), 9000)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => toasts,
  )
}
