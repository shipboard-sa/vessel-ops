/**
 * Purpose: Schedule tab shell - bucket tabs plus task cards, and a full-screen
 *   focus view of one task's full record with "← Back to schedule".
 * Version: v5 (2026-09-23) - v5: an AppNav origin (NavScope) - a system, item, project etc. named
 *   anywhere on the board or in a task record opens on its own tab and Back comes back here with
 *   the same bucket and record; task links stay on this trail; Done today splits system / task
 *   into two targets (tracker #74). v4 2026-09-19
 * Scope: PRODUCTION - mx-inv frontend, schedule feature (daily-driver screen).
 * Architecture: Rendered by App.tsx; reads useSchedule. Owns the focused-task
 *   trail; TaskCard rows call onOpenRecord. The focus screen is Management's
 *   TaskDetail (same pattern as ProjectsView). The board stays mounted but
 *   `hidden` while focused so tab, scroll and expanded cards survive Back.
 *   Saves in TaskDetail invalidate ['schedule'] (management/mutations.ts).
 *   v3 (tracker #29): a task completed TODAY drops out of the action lists
 *   (Critical / Overdue / Due Today / This Week / As-used) into a "Done today"
 *   fold under each list, so completing visibly shortens the list. The projection
 *   is unchanged: the task still reappears in its calendar bucket (This Month /
 *   This Quarter) with its new due date, and in these lists again when it is due.
 *   v4: a "🧾 Log" tab (the completion audit trail, schema v26) and completion toasts
 *   (a confirmation that outlives the card, and a visible error when a completion fails).
 */
import { useEffect, useState } from 'react'
import { useSchedule } from './useSchedule'
import { TaskCard } from './TaskCard'
import { CompletionLog } from './CompletionLog'
import { CompletionToasts } from './CompletionToasts'
import { useTasks } from '../management/useTasks'
import { TaskDetail } from '../management/TaskDetail'
import { FocusScreen, useFocusTrail } from '../../components/FocusScreen'
import { NavScopeProvider, useAppNav, useReturnRestore, type RecordRef } from '../../components/AppNav'
import { SystemTaskLabel } from '../../components/RecordLink'
import type { BucketName, TaskRow } from '../../api/types'
import './ScheduleBoard.css'

const BUCKET_LABELS: Record<BucketName, string> = {
  critical: '🔴 Critical',
  overdue: '⚠️ Overdue',
  today: '📅 Due Today',
  week: '📆 This Week',
  month: '🗓️ This Month',
  quarter: '📋 This Quarter',
  hours: '⏱️ Run Hours',
  // Key stays 'checklists' (backend bucket name); the label says what it really
  // holds: as-used tasks (no calendar date) plus real checklists (the owner 2026-09-19).
  checklists: '🏁 As-used',
}

const BUCKET_ORDER: BucketName[] = [
  'critical', 'overdue', 'today', 'week', 'month', 'quarter', 'hours', 'checklists',
]

// Matches schedule_modules.py's per-tab captions.
const BUCKET_CAPTIONS: Partial<Record<BucketName, string>> = {
  critical: 'Safety-flagged tasks (boat-to-float / finish-the-passage) that are overdue right now — '
    + 'the ones that really need doing now, most overdue first. A cross-cutting view: the same '
    + 'task is also on the Overdue tab. Flagged tasks that are not yet due are not shown here.',
  checklists: 'As-used tasks: no calendar due date — logged when performed rather than on a '
    + 'schedule. Rows marked ✅ are real checklists and open to their steps; the rest are '
    + 'ordinary tasks with no sub-tasks.',
}

// The lists you ACT on. Month / Quarter / Run Hours are forward-looking calendar views, so a
// task just completed legitimately shows there with its next due date; in these it should not.
const ACTION_BUCKETS: ReadonlySet<BucketName> = new Set<BucketName>([
  'critical', 'overdue', 'today', 'week', 'checklists',
])

export function ScheduleBoard() {
  const { data, isLoading, isError, error } = useSchedule()
  const [bucket, setBucket] = useState<BucketName | 'log'>('critical')
  const { data: allTasks } = useTasks()
  const focus = useFocusTrail<number>()
  const { clear: clearFocus } = focus
  const focusedId = focus.current
  const focused = focusedId === null ? null : (allTasks ?? []).find((t) => t.task_id === focusedId) ?? null

  // Tracker #74: this tab is an origin. Task links stay on this trail; anything else opens on its
  // own tab, and Back comes back to the same bucket and record.
  const appNav = useAppNav()
  useReturnRestore('schedule', (r) => {
    if (r.extra) setBucket(r.extra as BucketName | 'log')
    if (r.trail) focus.openPath(r.trail as number[])
  })
  const scope = {
    origin: () => ({ tab: 'schedule' as const, trail: focus.trail, extra: bucket }),
    openLocal: (ref: RecordRef) => {
      if (ref.kind !== 'task') return false
      const i = focus.trail.indexOf(ref.id)
      if (i >= 0) focus.goTo(i + 1); else if (focus.trail.length) focus.push(ref.id); else focus.open(ref.id)
      return true
    },
  }
  const openSystem = (name: string) => appNav?.openRecord({ kind: 'system', name }, scope.origin())

  // The focused task can vanish (deleted from its own editor) - fall back to the board.
  useEffect(() => {
    if (focusedId !== null && allTasks && !focused) clearFocus()
  }, [focusedId, allTasks, focused, clearFocus])

  if (isLoading) return <p className="schedule-status">Loading schedule…</p>
  if (isError) {
    return <p className="schedule-status schedule-status--error">{(error as Error).message}</p>
  }
  if (!data) return null

  const isDoneToday = (r: TaskRow) =>
    !!r.last_completed_date && r.last_completed_date.trim() === data.generated_at
  const splitBucket = (b: BucketName) => {
    const all = data.buckets[b]
    if (!ACTION_BUCKETS.has(b)) return { rows: all, done: [] as TaskRow[] }
    return { rows: all.filter((r) => !isDoneToday(r)), done: all.filter(isDoneToday) }
  }
  const { rows, done } = bucket === 'log' ? { rows: [] as TaskRow[], done: [] as TaskRow[] } : splitBucket(bucket)

  return (
    <NavScopeProvider scope={scope}>
      {focused && (
        <FocusScreen
          focus={focus}
          listLabel="schedule"
          labelOf={(id) => (allTasks ?? []).find((t) => t.task_id === id)?.task_name ?? 'task'}
        >
          <TaskDetail
            key={focused.task_id}
            task={focused}
            onClose={focus.clear}
            onNavigateToTask={focus.push}
            onOpenSystem={appNav ? openSystem : undefined}
          />
        </FocusScreen>
      )}

      <CompletionToasts />

      {/* Kept mounted (just hidden) while a record is focused, so the tab,
          scroll position and expanded cards are all still there on Back. */}
      <div className="schedule-board" hidden={!!focused}>
        <p className="schedule-meta">
          {data.meta.active_count} active tasks · {data.meta.parked_count} parked on a project ·{' '}
          {data.meta.subtask_count} subtasks shown under their parent · generated {data.generated_at}
        </p>

        <nav className="schedule-tabs">
          {BUCKET_ORDER.map((b) => (
            <button
              key={b}
              type="button"
              className={b === bucket ? 'active' : undefined}
              onClick={() => setBucket(b)}
            >
              {BUCKET_LABELS[b]} <span className="schedule-tab-count">{splitBucket(b).rows.length}</span>
            </button>
          ))}
          <button
            type="button"
            className={bucket === 'log' ? 'active' : undefined}
            onClick={() => setBucket('log')}
            title="Every completion the app has recorded"
          >
            🧾 Log
          </button>
        </nav>

        {bucket === 'log' && <CompletionLog onOpenRecord={focus.open} />}

        <section className="schedule-workarea" hidden={bucket === 'log'}>
          {bucket !== 'log' && BUCKET_CAPTIONS[bucket] && <p className="schedule-bucket-caption">{BUCKET_CAPTIONS[bucket]}</p>}
          <p className="schedule-status">{rows.length} task(s)</p>
          {rows.length === 0 ? (
            <p className="bucket-empty">
              {done.length > 0
                ? 'All done here for today.'
                : 'Clear deck! No tasks found within this category.'}
            </p>
          ) : (
            <ul className="schedule-worklist">
              {rows.map((row) => (
                <TaskCard key={row.task_id} row={row} onOpenRecord={focus.open} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="schedule-done-today">
              <summary>✅ Done today ({done.length})</summary>
              <ul>
                {done.map((row) => (
                  <li key={row.task_id}>
                    <SystemTaskLabel
                      system={row.system} taskId={row.task_id} taskName={row.task_name}
                      onOpenTask={() => focus.open(row.task_id)}
                    />
                    <span className="schedule-done-next">
                      {row.interval_type_clean === 'use' ? ' · as-used, logged today' : ` · next due ${row.calculated_due_date}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </NavScopeProvider>
  )
}
