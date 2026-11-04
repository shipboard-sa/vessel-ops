/**
 * Purpose: "Return from Layup" - bulk-defer every task that came due while the boat sat idle
 *   out to the back-in-service date, without touching completion history.
 * Version: v2 (2026-09-23)
 *   - v2: each candidate is a CheckRow - the box (de)selects, the system and the task name each
 *     open their own record (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, layup-return feature (its own top-level tab).
 * Architecture: Reads the projected schedule (schedule/useSchedule), writes per-task deferrals
 *   via schedule/mutations useSetDeferral (same math as ScheduleBoard's DeferUntil).
 */
import { useMemo, useState } from 'react'
import { useSchedule } from '../schedule/useSchedule'
import { useSetDeferral } from '../schedule/mutations'
import type { TaskRow } from '../../api/types'
import { CheckRow, SystemTaskLabel } from '../../components/RecordLink'
import './LayupReturnTool.css'

// "Bulk-defer everything that went overdue during a layup" per the owner
// (2026-09-16): the boat sat idle, so due dates - not service history -
// are what's wrong. This pushes each candidate task's due date out to the
// back-in-service date via the existing per-task deferral mechanism
// (same math as ScheduleBoard's DeferUntil control); it never touches
// last_completed_date, so nothing is falsely logged as serviced and
// nothing reaches the vessel log.
export function LayupReturnTool() {
  const { data, isLoading } = useSchedule()
  const setDeferral = useSetDeferral()

  const [layupStart, setLayupStart] = useState('')
  const [backInService, setBackInService] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [applied, setApplied] = useState<number | null>(null)

  const candidates = useMemo(() => {
    if (!data || !layupStart || !backInService) return []
    return data.all_projected.filter((r) =>
      r.parent_task_id === null
      && !r.parked
      && !r.retired
      && (r.interval_type_clean === 'days' || r.interval_type_clean === 'break_fix')
      && r.calculated_due_date >= layupStart
      && r.calculated_due_date <= backInService,
    )
  }, [data, layupStart, backInService])

  const toggle = (taskId: number) => {
    setExcluded((s) => {
      const next = new Set(s)
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
      return next
    })
  }

  const apply = () => {
    const targets = candidates.filter((r) => !excluded.has(r.task_id))
    const base = new Date(backInService)
    let done = 0
    targets.forEach((r) => {
      const orig = new Date(r.original_due_date)
      const units = Math.max(0, Math.round((base.getTime() - orig.getTime()) / 86_400_000))
      setDeferral.mutate({ taskId: r.task_id, units })
      done += 1
    })
    setApplied(done)
  }

  if (isLoading) return <p className="mgmt-status">Loading schedule…</p>

  return (
    <div className="layup-tool">
      <h2>↩ Return from Layup</h2>
      <p className="mgmt-status">
        Push due dates for everything that went overdue while the boat sat idle out to your
        back-in-service date, without touching completion history. Deselect anything that's a
        genuine miss regardless of the layup (a safety recert, say) before applying.
      </p>

      <div className="layup-dates">
        <label>
          Layup started
          <input type="date" value={layupStart} onChange={(e) => { setLayupStart(e.target.value); setApplied(null) }} />
        </label>
        <label>
          Back in service
          <input type="date" value={backInService} onChange={(e) => { setBackInService(e.target.value); setApplied(null) }} />
        </label>
      </div>

      {layupStart && backInService && (
        <>
          <p className="mgmt-status">
            {candidates.length} task(s) came due in that window
            {excluded.size > 0 && ` — ${excluded.size} deselected as genuine`}.
          </p>
          {candidates.length === 0 ? (
            <p className="bucket-empty">Nothing came due in that window.</p>
          ) : (
            <ul className="layup-candidate-list">
              {candidates.map((r: TaskRow) => (
                <li key={r.task_id} className={excluded.has(r.task_id) ? 'excluded' : undefined}>
                  <CheckRow
                    checked={!excluded.has(r.task_id)} onToggle={() => toggle(r.task_id)}
                    to={null}
                    name={<>
                      {!!r.is_critical && <span className="mgmt-critical-dot" title="Critical" />}
                      <SystemTaskLabel system={r.system} taskId={r.task_id} taskName={r.task_name} />
                    </>}
                  >
                    <span className="layup-due-date">due {r.calculated_due_date}</span>
                  </CheckRow>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="layup-apply-btn"
            disabled={candidates.length === excluded.size || setDeferral.isPending}
            onClick={apply}
          >
            {setDeferral.isPending ? 'Applying…' : `Defer ${candidates.length - excluded.size} task(s) to ${backInService}`}
          </button>
          {applied !== null && (
            <p className="layup-applied">✅ Deferred {applied} task(s) to {backInService}.</p>
          )}
        </>
      )}
    </div>
  )
}
