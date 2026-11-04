/**
 * Purpose: The "Details" screen for one checklist step (or a task linked into a checklist):
 *   the full how-to, what you need (parts / tools / supplies, on hand and where stowed) and its
 *   references, so someone working a checklist can see everything about a step without
 *   leaving the run (tracker #28, the owner 2026-09-20).
 * Version: v2 (2026-09-23) - v2: the step's system and "a step of X" open their records, and
 *   "Open full record →" is offered wherever AppNav exists, not only when a caller wires it (#74)
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: A read-first screen opened as a focus screen (with a Back to the checklist) by
 *   RunChecklistView, and in place of the checklist by CockpitChecklists (tablet, read-only:
 *   `canEdit` false). Management / Projects / Schedule instead open the step's full record
 *   (TaskDetail, which embeds the same TaskNeeds). Data: useTasks (the task row), TaskNeeds
 *   (items-demand + edits), useTaskReferences. Information only - it never completes the step or
 *   draws stock.
 */
import type { TaskReference } from '../../api/types'
import { useTaskReferences, useTasks } from './useTasks'
import { TaskNeeds } from './TaskNeeds'
import { RecordLink } from '../../components/RecordLink'
import { useOpenRecord } from '../../components/AppNav'
import './StepDetail.css'

export function StepDetail({
  taskId, canEdit, onOpenRecord,
}: {
  taskId: number
  /** Let the reader add / remove parts and tools (off on the cockpit tablet). */
  canEdit: boolean
  /** When given, shows "Open full record →" (the editor); the cockpit doesn't offer it. */
  onOpenRecord?: (taskId: number) => void
}) {
  const { data: tasks } = useTasks()
  const { data: refs } = useTaskReferences(taskId)
  const openRecord = useOpenRecord()
  const openFull = onOpenRecord ?? (openRecord ? (id: number) => openRecord({ kind: 'task', id }) : undefined)
  const task = tasks?.find((t) => t.task_id === taskId)
  if (!tasks) return <p className="mgmt-status">Loading…</p>
  if (!task) return <p className="mgmt-status mgmt-status--error">That task no longer exists.</p>

  const parent = task.parent_task_id != null ? tasks.find((t) => t.task_id === task.parent_task_id) : undefined
  const citations = (refs ?? []).filter((r: TaskReference) => r.kind !== 'task')
  const howTo = (task.task_description ?? '').trim()
  const notes = (task.caution_notes ?? '').trim()

  return (
    <div className="step-detail-screen">
      <h2>{task.task_name}</h2>
      <p className="mgmt-status">
        <RecordLink to={{ kind: 'system', name: task.system }}><code>{task.system}</code></RecordLink>
        {parent && <> · a step of <strong><RecordLink to={{ kind: 'task', id: parent.task_id }}>{parent.task_name}</RecordLink></strong></>}
        {task.last_completed_date ? ` · last done ${task.last_completed_date}` : ''}
      </p>

      {(howTo || notes) ? (
        <div className="step-detail-howto">
          <h3>How to do it</h3>
          {howTo && <p>{howTo}</p>}
          {notes && notes !== howTo && <p className="step-detail-notes">⚠️ {notes}</p>}
        </div>
      ) : (
        <p className="mgmt-status">No how-to written for this step yet.</p>
      )}

      <TaskNeeds taskId={taskId} canEdit={canEdit} />

      {citations.length > 0 && (
        <div className="step-detail-refs">
          <h3>References</h3>
          <ul>
            {citations.map((r) => (
              <li key={r.ref_id}>
                <span className="task-reference-kind">{r.kind}</span>{' '}
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.label}</a> : <span>{r.label}</span>}
                {r.page ? `, p.${r.page}` : ''}
                {r.note && <span className="task-reference-note"> — {r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {openFull && (
        <button type="button" className="task-open-record" onClick={() => openFull(taskId)}>
          Open full record →
        </button>
      )}
    </div>
  )
}
