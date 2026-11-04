/**
 * Purpose: "How did it go?" + follow-on task(s) - the shared outcome picker and follow-on
 *   editor for logging work (schema v34, tracker #44).
 * Version: v4 (2026-09-23) - v4: EVENT_KIND_LABELS for past-service records (#44 event kinds). v3 (2026-09-23) - v3 (tracker #76, no-detour): a follow-on's system is the shared
 *   SystemPicker (type to search, "＋ New system / device" first) - it shows the job's own system
 *   until changed, and picking that again means "same as the job" (system null).
 *   v2 (2026-09-22) - v2 (tracker #70): each follow-on row picks its urgency - Routine
 *   (default) / Urgent / Drop everything; they were all created "drop everything" before.
 * Scope: PRODUCTION - mx-inv frontend, schedule feature.
 * Architecture: Used by the Complete panel (TaskCardDetail), the past-service-record form
 *   (HistoricalRecordForm) and - follow-on editor only - the Log row's "＋ Follow-on task"
 *   (CompletionLog). The values post with the completion; the backend writes the outcome on
 *   the history row and creates each follow-on as a one-off break/fix task whose
 *   origin_completion_id points back at it (data._insert_follow_ons) - one entry -> many.
 *
 * Why "partly done" still counts as done for the schedule: the unfinished part is what the
 * follow-on task is FOR. Leaving the recurring clock unset instead would make a half-done job
 * look like it was never started, and would fight the void/undo logic.
 */
import { useId } from 'react'
import type { CompletionOutcome, FollowOnDraft, FollowOnUrgency } from '../../api/types'
import { useSystems } from '../management/useTasks'
import { SystemPicker } from '../management/SystemPicker'

/** What sort of history event (data.COMPLETION_EVENT_KINDS); '' = plain service. */
export const EVENT_KIND_LABELS: Record<string, string> = {
  grounding: 'Grounding', survey: 'Survey', haul_out: 'Haul-out', modification: 'Modification / install',
  incident: 'Incident',
}

export const OUTCOME_LABELS: Record<CompletionOutcome, string> = {
  done_ok: 'Done - all good',
  problem_found: 'Problem found',
  partial: 'Partly done',
}

export const needsFollowOn = (o: CompletionOutcome | null) => o === 'problem_found' || o === 'partial'

export function blankFollowOn(): FollowOnDraft {
  return { task_name: '', system: null, is_critical: false, urgency: 'routine' }
}

// tracker #70: how soon the follow-on needs doing - the same three break/fix levels the
// schedule already shows (Routine Repair / Action Urgent / DROP EVERYTHING).
export const URGENCY_LABELS: Record<FollowOnUrgency, string> = {
  routine: 'Routine',
  urgent: 'Urgent',
  immediate: 'Drop everything',
}

/** Only the rows with a name - what actually gets sent. */
export function followOnsToSend(rows: FollowOnDraft[]) {
  return rows.filter((r) => r.task_name.trim())
    .map((r) => ({
      task_name: r.task_name.trim(), system: r.system || null, is_critical: r.is_critical,
      urgency: r.urgency,
    }))
}

export function OutcomePicker({
  value, onChange,
}: { value: CompletionOutcome | null; onChange: (v: CompletionOutcome | null) => void }) {
  const group = `outcome-${useId()}` // two open cards must not share one radio group
  return (
    <fieldset className="outcome-picker">
      <legend>How did it go?</legend>
      {(Object.keys(OUTCOME_LABELS) as CompletionOutcome[]).map((k) => (
        <label key={k} className={`outcome-option outcome-option--${k}`}>
          <input type="radio" name={group} checked={(value ?? 'done_ok') === k}
            onChange={() => onChange(k === 'done_ok' ? null : k)} />
          {OUTCOME_LABELS[k]}
        </label>
      ))}
    </fieldset>
  )
}

export function FollowOnEditor({
  rows, onChange, jobSystem, hint,
}: {
  rows: FollowOnDraft[]
  onChange: (rows: FollowOnDraft[]) => void
  /** The job's own system/device - the default for each follow-on. */
  jobSystem: string | null
  hint?: string
}) {
  const { data: systems } = useSystems()
  const setRow = (i: number, patch: Partial<FollowOnDraft>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="follow-on-editor">
      <strong>Follow-on task(s)</strong>
      <p className="task-detail-hint">
        {hint ?? 'What still needs doing because of this job. Each becomes its own break/fix task, linked back to this entry.'}
      </p>
      {rows.map((r, i) => (
        <div key={i} className="follow-on-row">
          <input value={r.task_name} placeholder="e.g. Replace the cracked hose clamp"
            onChange={(e) => setRow(i, { task_name: e.target.value })} />
          {/* Where the follow-on work lives - null = the job's own system/device. */}
          <SystemPicker
            value={r.system ?? jobSystem ?? ''}
            systems={systems ?? []}
            onChange={(name) => setRow(i, { system: name && name !== jobSystem ? name : null })}
          />
          <select value={r.urgency} onChange={(e) => setRow(i, { urgency: e.target.value as FollowOnUrgency })}
            title="How soon it needs doing">
            {(Object.keys(URGENCY_LABELS) as FollowOnUrgency[]).map((k) => (
              <option key={k} value={k}>{URGENCY_LABELS[k]}</option>
            ))}
          </select>
          <label className="follow-on-critical" title="Flag it critical (float / finish the passage)">
            <input type="checkbox" checked={r.is_critical}
              onChange={(e) => setRow(i, { is_critical: e.target.checked })} /> 🔴
          </label>
          {rows.length > 1 && (
            <button type="button" className="link-button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
              title="Remove this row">✕</button>
          )}
        </div>
      ))}
      <button type="button" className="link-button" onClick={() => onChange([...rows, blankFollowOn()])}>
        ＋ another follow-on
      </button>
    </div>
  )
}
