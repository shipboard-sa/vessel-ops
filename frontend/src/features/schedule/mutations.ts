/**
 * Purpose: The schedule's write hooks - complete (with spares used, notes, who, outcome, follow-ons), void, past
 *   service records, follow-ons, defer / clear deferral, task notes.
 * Version: v2 (2026-10-05) - v2: completing a FIX task that a ship's-log failure raised offers to mark that failure
 *   Fixed (the owner's Ship's Log review; GET /api/logbook/raised-by/{task}, then POST /api/logbook/{id}/status).
 *   v1 = everything before this header was added.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: react-query mutations over backend/routers/tasks.py (+ the logbook router for the Fixed offer); each
 *   invalidates the schedule rather than patching it. The offer uses the shared ConfirmDialog (useConfirm).
 * Invocation: imported by features/schedule/TaskCardDetail.tsx and the schedule's Log tab components.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../api/client'
import { todayLocal } from '../../api/date'
import { pushToast } from './completionToast'
import { lateness } from './lateness'
import type { CompletionOutcome, LogEntry } from '../../api/types'
import { useConfirm } from '../../components/ConfirmDialog'

// Complete/defer/clear-deferral all change due-date projection, so every
// mutation here invalidates the schedule query rather than patching it
// locally - matches app.py's st.rerun(scope="app") behaviour ("deferral
// moves the due date - needs a full re-derive").

function useScheduleMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  })
}

export interface CompletionResult {
  consumed: { item_id: number; item_name: string; unit: string; quantity: number; stock_id: number }[]
  shortfalls: { item_id: number; item_name: string; unit: string; short_by: number }[]
  subtasks_closed: number
  completion_id: number
  /** Positive = late, negative = early, 0 = on time, null = no schedule to be late against. */
  days_past_due: number | null
  hours_past_due: number | null
  /** v34: follow-on tasks created in the same transaction. */
  follow_on_task_ids?: number[]
}

export interface CompleteVars {
  taskId: number
  /** For the confirmation message only. */
  taskName: string
  completedOn: string
  consumption?: { item_id: number; quantity: number }[]
  closeSubtasks?: boolean
  /** Free text kept on THIS completion in the history (not the task's own caution notes). */
  notes?: string
  /** Who did the work - a TEXT snapshot on the history row, offered from the crew list. */
  performedBy?: string
  /** v34: how it went (null = not stated) and the follow-on tasks it raised. */
  outcome?: CompletionOutcome | null
  followOns?: { task_name: string; system: string | null; is_critical: boolean }[]
}

// Completing a task takes its card off the list, which used to take the "Completed" note
// with it - success left no trace, and a failed request showed nothing at all (tracker
// #29). The toasts are pushed from mutation-level callbacks, which still run after the card
// has unmounted; the log tab (schema v26 audit trail) is the durable record.
export function useCompleteTask() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  // the owner 2026-10-05: a FIX task raised by a logbook failure offers to mark that failure Fixed when it is done -
  // an offer, never automatic (a partial fix must not close it). Yes appends 'fixed' to the failure's status chain.
  const offerFixed = async (vars: CompleteVars) => {
    let open: LogEntry[] = []
    try {
      open = await apiGet<LogEntry[]>(`/logbook/raised-by/${vars.taskId}`)
    } catch {
      return                                   // the log is unreachable: the completion itself is already recorded
    }
    for (const f of open) {
      const yes = await confirm({
        title: `Mark ${f.entry_ref} Fixed?`,
        message: `"${vars.taskName}" was raised by ${f.entry_ref} - ${f.title}. Mark that failure Fixed in the ship's log?`
          + (vars.outcome === 'partial' ? ' (This completion was logged as partly done.)' : ''),
        confirmLabel: 'Mark it Fixed', cancelLabel: 'Not yet',
      })
      if (!yes) continue
      try {
        await apiSend('POST', `/logbook/${f.entry_id}/status`, {
          status: 'fixed', note: vars.notes?.trim() || `Fix task done: ${vars.taskName}`,
          author: vars.performedBy?.trim() || null,
        })
        pushToast('ok', `✅ ${f.entry_ref} marked Fixed in the ship's log`)
        queryClient.invalidateQueries({ queryKey: ['logbook'] })
      } catch (err) {
        pushToast('error', `❌ Could not mark ${f.entry_ref} Fixed: ${(err as Error).message}`)
      }
    }
  }
  return useMutation<CompletionResult, Error, CompleteVars>({
    mutationFn: ({ taskId, completedOn, consumption, closeSubtasks, notes, performedBy, outcome, followOns }) =>
      apiSend<CompletionResult>('POST', `/tasks/${taskId}/complete`, {
        completed_on: completedOn,
        consumption: consumption && consumption.length ? consumption : null,
        close_subtasks: !!closeSubtasks,
        notes: notes && notes.trim() ? notes.trim() : null,
        performed_by: performedBy && performedBy.trim() ? performedBy.trim() : null,
        outcome: outcome ?? null,
        follow_ons: followOns && followOns.length ? followOns : null,
      }),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['completions'] })
      if (res.follow_on_task_ids?.length) queryClient.invalidateQueries({ queryKey: ['tasks'] })
      const notToday = vars.completedOn !== todayLocal()
      const late = lateness(res.days_past_due, res.hours_past_due)
      pushToast(
        'ok',
        `✅ Completed “${vars.taskName}” — logged for ${vars.completedOn}`
        + (late ? ` (${late.text})` : '')
        + (res.follow_on_task_ids?.length
          ? ` · ${res.follow_on_task_ids.length} follow-on task${res.follow_on_task_ids.length === 1 ? '' : 's'} created`
          : '')
        + (notToday ? ' (not today: a task that is overdue by more than its period stays overdue)' : ''),
      )
      void offerFixed(vars)
    },
    onError: (err, vars) => {
      pushToast('error', `❌ Could not log the completion of “${vars.taskName}”: ${err.message}. Nothing was recorded - try again.`)
    },
  })
}

// Append-only correction: the history row stays, marked voided with the reason. Voiding a
// task's latest completion also puts its schedule back, so the schedule must refresh too.
export function useVoidCompletion() {
  const queryClient = useQueryClient()
  return useMutation<{ restored: boolean }, Error, { completionId: number; reason: string }>({
    mutationFn: ({ completionId, reason }) =>
      apiSend<{ restored: boolean }>('POST', `/tasks/completions/${completionId}/void`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['completions'] })
    },
  })
}

// Tracker #44 (the CARFAX backfill): record work the app never saw - a yard invoice, a
// rigger's job, anything done before this existed. It lands in the same append-only history
// as a ticked completion, marked source='historical', and reschedules nothing.
export interface HistoricalRecordVars {
  system: string
  what_was_done: string
  completed_on: string
  /** schema v33: the invoice on file this work was paid under (then cost stays null). */
  document_id?: number | null
  /** v34: how it went + follow-on tasks raised from it. */
  outcome?: CompletionOutcome | null
  /** v32 columns: what sort of event, and a path to its photo / PDF on disk. */
  event_kind?: string | null
  evidence_path?: string | null
  follow_ons?: { task_name: string; system: string | null; is_critical: boolean }[] | null
  performed_by?: string | null
  vendor?: string | null
  cost?: number | null
  notes?: string | null
}

export function useAddHistoricalRecord() {
  const queryClient = useQueryClient()
  return useMutation<{ completion_id: number }, Error, HistoricalRecordVars>({
    mutationFn: (body) =>
      apiSend<{ completion_id: number }>('POST', '/tasks/completions/historical', body),
    onSuccess: () => {
      // prefix match - covers both ['completions', filter] and ['completions','facets']
      queryClient.invalidateQueries({ queryKey: ['completions'] })
      queryClient.invalidateQueries({ queryKey: ['documents'] }) // an invoice's jobs-filed count
      queryClient.invalidateQueries({ queryKey: ['schedule'] }) // follow-on tasks, if any
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

// v34: raise follow-on task(s) from an existing history entry (one entry -> many).
export function useAddFollowOns() {
  const queryClient = useQueryClient()
  return useMutation<{ task_ids: number[] }, Error, {
    completionId: number; followOns: { task_name: string; system: string | null; is_critical: boolean }[]
  }>({
    mutationFn: ({ completionId, followOns }) =>
      apiSend<{ task_ids: number[] }>('POST', `/tasks/completions/${completionId}/follow-ons`, { follow_ons: followOns }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['completions'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeferTask() {
  return useScheduleMutation(({ taskId, extraUnits }: { taskId: number; extraUnits: number }) =>
    apiSend('POST', `/tasks/${taskId}/defer`, { extra_units: extraUnits }),
  )
}

export function useSetDeferral() {
  return useScheduleMutation(({ taskId, units }: { taskId: number; units: number }) =>
    apiSend('PUT', `/tasks/${taskId}/deferral`, { units }),
  )
}

export function useClearDeferral() {
  return useScheduleMutation((taskId: number) =>
    apiSend('DELETE', `/tasks/${taskId}/deferral`),
  )
}

export function useSaveNote() {
  return useScheduleMutation(({ taskId, notes }: { taskId: number; notes: string }) =>
    apiSend('PATCH', `/tasks/${taskId}`, { caution_notes: notes }),
  )
}
