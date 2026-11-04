/**
 * Purpose: Expanded body of a Schedule task card - Done/complete flow, Defer
 *   controls, notes, checklist steps, and an "Open full record" button.
 * Version: v7 (2026-09-23) - v7: "＋ Used something else" under the tick-what-you-used list -
 *   any catalog item (or one created inline) goes into the completion's consumption, optionally
 *   remembered on the task for next time (tracker #76, shared UsedSomethingElse from
 *   management/ChecklistSteps). v6: every record name opens its detail page - system chip, the
 *   follow-on origin job, item names on the "tick what you used up" rows (box ticks, name opens),
 *   and the task / items / follow-ons named in the "logged" result (tracker #74). v5: the "+N" defer bump counts from TODAY (tracker #68 - the
 *   math is server-side in data.defer_task); the control says so. v4: "How did it go?" (outcome) on the Complete panel, and when a
 *   problem was found or the job was only partly done, follow-on task(s) created in the same
 *   call (schema v34, one entry -> many); a follow-on task shows where it came from. v3 was
 *   2026-09-19.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Rendered by TaskCard when a card is expanded. Quick actions
 *   stay inline (schedule/mutations.ts); the full task record editor is no
 *   longer embedded here - onOpenRecord asks ScheduleBoard to open
 *   Management's TaskDetail as a focus screen. The Complete panel also takes a note
 *   kept on THAT completion in the append-only history (distinct from the task's own
 *   caution notes above).
 */
import { useState } from 'react'
import type { TaskRow } from '../../api/types'
import { todayLocal } from '../../api/date'
import { useTaskItemsDemand, useOpenSubtasks } from './useTaskDetail'
import {
  useClearDeferral, useCompleteTask, useDeferTask, useSaveNote, useSetDeferral,
  type CompletionResult,
} from './mutations'
import {
  ChecklistSteps, UsedSomethingElse, extraConsumption, rememberExtras, type ExtraUsed,
} from '../management/ChecklistSteps'
import { useSetTaskItem } from '../management/mutations'
import { lateness } from './lateness'
import { PerformedByField } from './PerformedByField'
import type { CompletionOutcome, FollowOnDraft } from '../../api/types'
import {
  FollowOnEditor, OUTCOME_LABELS, OutcomePicker, blankFollowOn, followOnsToSend, needsFollowOn,
} from './OutcomeFields'
import { CheckRow, RecordLink } from '../../components/RecordLink'
import { useTasks } from '../management/useTasks'

/** "↩ Follow-on from: <job> (<date>, problem found)" - the history entry that raised this task. */
export function FollowOnOrigin({ row }: {
  row: {
    origin_task_name?: string | null; origin_task_id?: number | null
    origin_completed_on?: string | null; origin_outcome?: string | null
  }
}) {
  const outcome = row.origin_outcome as CompletionOutcome | null | undefined
  return (
    <p className="task-follow-on-origin">
      ↩ Follow-on from{' '}
      <strong>
        <RecordLink to={row.origin_task_id ? { kind: 'task', id: row.origin_task_id } : null}>
          {row.origin_task_name ?? 'a history entry'}
        </RecordLink>
      </strong>
      {row.origin_completed_on && <> ({row.origin_completed_on}{outcome ? `, ${OUTCOME_LABELS[outcome].toLowerCase()}` : ''})</>}
      {' '}- see the Log.
    </p>
  )
}

const TYPE_GLYPH: Record<string, string> = {
  part: '⚙️', spare_unit: '🔁', supply: '🧴', tool: '🔧', tool_accessory: '🪛', food: '🥫',
}

export function TaskCardDetail({
  row, deferrable, bump, onOpenRecord,
}: { row: TaskRow; deferrable: boolean; bump: number; onOpenRecord: (taskId: number) => void }) {
  const { data: items } = useTaskItemsDemand(row.task_id, true)
  const { data: openSubtasks } = useOpenSubtasks(row.task_id, true)

  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [qty, setQty] = useState<Record<number, number>>({})
  const [extras, setExtras] = useState<ExtraUsed[]>([])
  const setTaskItem = useSetTaskItem()
  const [closeSubs, setCloseSubs] = useState(false)
  const [completedOn, setCompletedOn] = useState(todayLocal())
  const [completionNotes, setCompletionNotes] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [outcome, setOutcome] = useState<CompletionOutcome | null>(null)
  const [followOns, setFollowOns] = useState<FollowOnDraft[]>([blankFollowOn()])
  const serverNotes = row.caution_notes ?? ''
  const [notes, setNotes] = useState(serverNotes)
  const [seenNotes, setSeenNotes] = useState(serverNotes)
  const [result, setResult] = useState<CompletionResult | null>(null)
  const [deferAmount, setDeferAmount] = useState(bump)

  const complete = useCompleteTask()
  const defer = useDeferTask()
  const clearDeferral = useClearDeferral()
  const saveNote = useSaveNote()
  const { data: allTasks } = useTasks()
  const taskNameById = new Map((allTasks ?? []).map((t) => [t.task_id, t.task_name]))

  // The card stays mounted while the full record is open, so notes edited there
  // arrive as a new server value: adopt it unless the box holds unsaved typing.
  if (serverNotes !== seenNotes) {
    setSeenNotes(serverNotes)
    if (notes === seenNotes) setNotes(serverNotes)
  }

  const runComplete = () => {
    const consumption = (items ?? [])
      .filter((it) => picked[it.item_id])
      .map((it) => ({ item_id: it.item_id, quantity: qty[it.item_id] ?? it.quantity_required }))
      .concat(extraConsumption(extras))
    const toRemember = extras
    complete.mutate(
      { taskId: row.task_id, taskName: row.task_name, completedOn, consumption,
        closeSubtasks: closeSubs, notes: completionNotes, performedBy,
        outcome, followOns: needsFollowOn(outcome) ? followOnsToSend(followOns) : [] },
      {
        onSuccess: (res) => {
          setResult(res)
          rememberExtras(row.task_id, toRemember, setTaskItem.mutate)
          setExtras([])
        },
      },
    )
  }

  return (
    <div className="task-detail-panel">
      <div className="task-detail-cols">
        <div className="task-detail-info">
          <p className="task-detail-system">
            <strong>System:</strong>{' '}
            <RecordLink to={{ kind: 'system', name: row.system }}><code>{row.system}</code></RecordLink>
            {!!row.is_critical && <span className="task-detail-critical"> · 🔴 Critical (float / finish the passage)</span>}
          </p>
          {row.origin_completion_id != null && <FollowOnOrigin row={row} />}
          {row.task_description && <p className="task-detail-desc">{row.task_description}</p>}

          <button type="button" className="task-open-record" onClick={() => onOpenRecord(row.task_id)}>
            Open full record →
          </button>

          {row.task_kind === 'checklist' && (
            <ChecklistSteps checklistId={row.task_id} onOpenStep={onOpenRecord} />
          )}

          {items && (
            <div className="task-items-checklist">
              <strong>{items.length > 0 ? 'Items — tick what you used up' : 'Items used'}</strong>
              {items.map((it) => (
                <CheckRow
                  key={it.item_id}
                  className="task-item-row"
                  checked={!!picked[it.item_id]}
                  onToggle={(b) => setPicked((s) => ({ ...s, [it.item_id]: b }))}
                  to={{ kind: 'item', id: it.item_id }}
                  name={<>{TYPE_GLYPH[it.item_type] ?? '•'} {it.item_name}</>}
                >
                  <span className="task-item-name">
                    · have {it.quantity_onhand} {it.unit}
                    {it.shortfall > 0 && <span className="task-item-short"> ⚠️ SHORT</span>}
                  </span>
                  <input
                    type="number" min={0} step={1}
                    className="task-item-qty"
                    value={qty[it.item_id] ?? it.quantity_required}
                    disabled={!picked[it.item_id]}
                    onChange={(e) => setQty((s) => ({ ...s, [it.item_id]: Number(e.target.value) }))}
                  />
                </CheckRow>
              ))}
              <UsedSomethingElse
                rows={extras}
                onChange={setExtras}
                listedIds={new Set(items.map((it) => it.item_id))}
              />
            </div>
          )}

          <label className="task-notes-editor">
            ✏️ Notes (edit / add your own)
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => saveNote.mutate({ taskId: row.task_id, notes })}
            disabled={saveNote.isPending}
          >
            Save notes
          </button>

          {result && (
            <div className={result.shortfalls.length ? 'task-result task-result--warn' : 'task-result'}>
              <strong><RecordLink to={{ kind: 'task', id: row.task_id }}>{row.task_name}</RecordLink></strong> logged
              {lateness(result.days_past_due, result.hours_past_due)?.text
                ? ` (${lateness(result.days_past_due, result.hours_past_due)?.text})`
                : ''}.
              {result.consumed.length > 0 && (
                <> Consumed: {result.consumed.map((c, i) => (
                  <span key={`${c.item_id}-${i}`}>
                    {i > 0 && ', '}
                    <RecordLink to={{ kind: 'item', id: c.item_id }}>{c.item_name}</RecordLink> −{c.quantity} {c.unit}
                  </span>
                ))}.</>
              )}
              {result.subtasks_closed > 0 && <> Closed {result.subtasks_closed} subtask(s).</>}
              {(result.follow_on_task_ids?.length ?? 0) > 0 && (
                <> Raised {result.follow_on_task_ids!.length} follow-on task(s) - they are on the schedule now:{' '}
                  {result.follow_on_task_ids!.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ', '}
                      <RecordLink to={{ kind: 'task', id }}>{taskNameById.get(id) ?? `task #${id}`}</RecordLink>
                    </span>
                  ))}.</>
              )}
              {result.shortfalls.length > 0 && (
                <> ⚠️ Stock ran short: {result.shortfalls.map((s, i) => (
                  <span key={`${s.item_id}-${i}`}>
                    {i > 0 && ', '}
                    <RecordLink to={{ kind: 'item', id: s.item_id }}>{s.item_name}</RecordLink> (short {s.short_by} {s.unit})
                  </span>
                ))}.</>
              )}
            </div>
          )}
        </div>

        <div className="task-detail-actions">
          <strong>Log completion</strong>
          <label>
            Completed on
            <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
          </label>
          {completedOn !== todayLocal() && (
            <p className="task-detail-hint task-complete-warning">
              ⚠️ Not today. A completion logged for an old date leaves an overdue task overdue.
            </p>
          )}
          <PerformedByField
            value={performedBy}
            onChange={setPerformedBy}
            hint="(optional)"
          />
          <label className="task-completion-notes">
            Notes for this completion
            <textarea
              rows={2}
              value={completionNotes}
              placeholder="What you found or did - kept in the history log"
              onChange={(e) => setCompletionNotes(e.target.value)}
            />
          </label>
          <OutcomePicker value={outcome} onChange={setOutcome} />
          {needsFollowOn(outcome) && (
            <FollowOnEditor rows={followOns} onChange={setFollowOns} jobSystem={row.system} />
          )}
          {openSubtasks && openSubtasks.length > 0 && (
            <label className="task-close-subs">
              <input type="checkbox" checked={closeSubs} onChange={(e) => setCloseSubs(e.target.checked)} />
              Also close {openSubtasks.length} subtask(s)
            </label>
          )}
          <button type="button" className="task-complete-btn" onClick={runComplete} disabled={complete.isPending}>
            {complete.isPending ? '…' : '✅ Complete'}
          </button>
          {complete.isError && (
            <p className="task-detail-hint task-complete-warning">
              ❌ Not recorded: {(complete.error as Error).message}
            </p>
          )}

          {row.interval_type_clean === 'break_fix' ? (
            <p className="task-detail-hint">Unscheduled repairs cannot be deferred.</p>
          ) : deferrable ? (
            <>
              <strong>Defer</strong>
              <div className="task-defer-row">
                <input
                  type="number" min={1} value={deferAmount}
                  onChange={(e) => setDeferAmount(Number(e.target.value))}
                />
                <button
                  type="button"
                  title={row.interval_type_clean === 'hrs'
                    ? `Due ${deferAmount} hours from the current meter reading (or ${deferAmount} h past its current due point, if that is later)`
                    : `Due ${deferAmount} days from today (or ${deferAmount} days past its current due date, if that is later)`}
                  onClick={() => defer.mutate({ taskId: row.task_id, extraUnits: deferAmount })}
                  disabled={defer.isPending}
                >
                  +{deferAmount}{row.interval_type_clean === 'hrs' ? 'h' : 'd'} from {row.days_remaining < 0 ? 'now' : 'due'}
                </button>
              </div>
              {row.deferred_days > 0 && (
                <button
                  type="button"
                  onClick={() => clearDeferral.mutate(row.task_id)}
                  disabled={clearDeferral.isPending}
                >
                  ↩︎ Reset to original date
                </button>
              )}
              {row.interval_type_clean === 'days' && (
                <DeferUntil taskId={row.task_id} originalDue={row.original_due_date} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DeferUntil({ taskId, originalDue }: { taskId: number; originalDue: string }) {
  const [date, setDate] = useState('')
  const setDeferral = useSetDeferral()

  return (
    <label className="task-defer-until">
      until
      <div className="task-defer-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          disabled={!date || setDeferral.isPending}
          onClick={() => {
            const base = new Date(originalDue)
            const target = new Date(date)
            const units = Math.round((target.getTime() - base.getTime()) / 86_400_000)
            setDeferral.mutate({ taskId, units: Math.max(0, units) })
          }}
        >
          Set date
        </button>
      </div>
    </label>
  )
}
