/**
 * Purpose: The consolidated "Referenced by" panel on a task's full record - every place the
 *   task is spoken for (its project, the checklist it is a native step of, every inbound
 *   task->task link, and its own steps), each removable on the spot, plus the retire/delete
 *   decision that follows from what history it carries.
 * Version: v4 (2026-09-23) - v4 (tracker #76, no-detour): "＋ New project…" / "＋ New checklist…"
 *   are the first choices in the two add-to pickers - a one-line name box creates it right here
 *   (POST /projects, POST /tasks/checklists) and the add carries on with it; the checklist picker
 *   shows even when there are no checklists yet.
 *   v3 (2026-09-23) - v3 (tracker #74): the project name opens the project, "a step of
 *   <checklist>" opens that checklist, and the checklist named in the "keep its own schedule?"
 *   question opens it.
 *   v2 (2026-09-22) - v2 (tracker #69, Owner: the old "Make it a step of…" vs "Link into a
 *   checklist…" pair was not clear): the owner's own words - "＋ Add as a step to a project…" and ONE
 *   "＋ Add as a step to a checklist…" picker, then one plain question, "Keep it on its own
 *   schedule too?" - Yes = LINK (it keeps its schedule), No = MOVE (it only comes up with that
 *   checklist). A task that is already a step elsewhere can only be linked, so it skips the question.
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered by TaskDetail.tsx (which opens from Schedule's "Open full record",
 *   Management and Projects, so this one panel covers all three). Replaces TaskInChecklists,
 *   whose "add to a checklist" control it absorbs. Reads GET /api/tasks/{id}/referenced-by;
 *   writes via PUT /{id}/project, PUT /{id}/parent, DELETE /references/{ref_id}, and
 *   POST /{id}/retire | /unretire. Delete stays in TaskDetail's action row.
 *
 * Why (tracker #66, the owner 2026-09-22): the pieces all existed but were scattered - the project
 *   lived in a picker, the parent checklist in another picker, checklist links in their own
 *   panel, and the inbound links whose source is NOT a checklist (a one-off that triggers a
 *   checklist, a step pointing at a related task - 64 of the 75 live links) appeared nowhere
 *   on the target task's screen at all. So "what would I break by deleting this?" had no
 *   answer anywhere, and Delete was an unlabelled scary button. One panel, one answer.
 */
import { useState } from 'react'
import type { RawTask, TaskReferencedBy as Referenced } from '../../api/types'
import { useTaskReferencedBy, useTasks } from './useTasks'
import {
  useAddTaskReference, useCreateChecklist, useDeleteTaskReference, useSetTaskParent, useUnretireTask,
} from './mutations'
import { useCreateProject, useSetTaskProject } from '../projects/mutations'
import { useProjects } from '../projects/useProjects'
import { useConfirm } from '../../components/ConfirmDialog'
import { RecordLink } from '../../components/RecordLink'

function errorText(e: unknown): string {
  const detail = (e as { detail?: { message?: string } } | null)?.detail
  return detail?.message ?? (e as Error).message
}

/** A checklist as far as the add-to flow needs it (a just-created one is not in useTasks yet). */
type ChecklistRef = Pick<RawTask, 'task_id' | 'task_name'>

const NEW = '__new__'

const KIND_ICON: Record<string, string> = {
  checklist: '✅',
  recurring: '🔁',
  one_off: '🛠️',
}

export function TaskReferencedBy({
  task, onNavigateToTask,
}: { task: RawTask; onNavigateToTask: (taskId: number) => void }) {
  const { data, isLoading } = useTaskReferencedBy(task.task_id)
  const { data: allTasks } = useTasks()
  const { data: projects } = useProjects()
  const setTaskProject = useSetTaskProject()
  const setTaskParent = useSetTaskParent()
  const deleteRef = useDeleteTaskReference()
  const addRef = useAddTaskReference()
  const unretire = useUnretireTask()
  const confirm = useConfirm()
  const [note, setNote] = useState<string | null>(null)
  // the checklist picked in "Add as a step to a checklist…", waiting on "keep its own schedule?"
  const [pendingChecklist, setPendingChecklist] = useState<ChecklistRef | null>(null)
  // tracker #76: which "＋ New …" name box is open under the add-to pickers
  const [creating, setCreating] = useState<'project' | 'checklist' | null>(null)
  const createProject = useCreateProject()
  const createChecklist = useCreateChecklist()

  if (isLoading || !data) return <div className="task-refby"><h3>Referenced by</h3><p className="mgmt-status">Loading…</p></div>

  const refCount = (data.project ? 1 : 0) + (data.parent ? 1 : 0) + data.links.length

  // Checklists this task is not already in (linked, or its parent).
  const linkedIds = new Set(data.links.map((l) => l.from_task_id))
  const choices = (allTasks ?? [])
    .filter((t) => t.task_kind === 'checklist' && t.parent_task_id == null && !t.retired
      && t.task_id !== task.task_id && t.task_id !== task.parent_task_id && !linkedIds.has(t.task_id))
    .sort((a, b) => a.task_name.localeCompare(b.task_name))

  // LINK: the checklist points at this same task, which keeps its own schedule.
  const linkInto = (c: ChecklistRef) => {
    setNote(null)
    setPendingChecklist(null)
    addRef.mutate(
      { taskId: c.task_id, kind: 'task', label: task.task_name, ref_task_id: task.task_id },
      { onSuccess: () => setNote(`✅ Added to ${c.task_name} - it keeps its own schedule.`) },
    )
  }
  // MOVE: it becomes that checklist's own step and leaves the rolling schedule.
  const moveInto = (c: ChecklistRef) => {
    setNote(null)
    setPendingChecklist(null)
    setTaskParent.mutate({ taskId: task.task_id, parentTaskId: c.task_id },
      { onSuccess: () => setNote(`✅ Now a step of ${c.task_name} - it comes up only with that checklist.`) })
  }
  // Picked (or just created) checklist: already a step of another one -> can only link, nothing to ask.
  const chooseChecklist = (c: ChecklistRef) => {
    if (data.parent) linkInto(c)
    else { setNote(null); setPendingChecklist(c) }
  }
  const putOnProject = (projectId: number, name: string) => {
    setNote(null)
    setTaskProject.mutate({ taskId: task.task_id, projectId },
      { onSuccess: () => setNote(`Put on ${name}.`) })
  }
  const newProject = (name: string) => {
    createProject.mutate({ name, kind: 'other' }, {
      onSuccess: (res) => { setCreating(null); putOnProject((res as { project_id: number }).project_id, name) },
    })
  }
  const newChecklist = (name: string) => {
    createChecklist.mutate({ name }, {
      onSuccess: (res) => { setCreating(null); chooseChecklist({ task_id: (res as { task_id: number }).task_id, task_name: name }) },
    })
  }

  return (
    <div className="task-refby">
      <h3>Referenced by {refCount > 0 && <span className="task-refby-count">{refCount}</span>}</h3>

      {data.retired_at && (
        <div className="task-refby-retired">
          <span>
            📦 Retired {data.retired_at.slice(0, 10)}
            {data.retired_reason ? ` — ${data.retired_reason}` : ''}. Off the schedule and out of
            the pick lists; its history is still here.
          </span>
          <button
            type="button" disabled={unretire.isPending}
            onClick={() => { setNote(null); unretire.mutate(task.task_id, { onSuccess: () => setNote('Back on the schedule.') }) }}
          >
            {unretire.isPending ? 'Restoring…' : '↩ Un-retire'}
          </button>
        </div>
      )}

      {refCount === 0 && (
        <p className="mgmt-status">
          Nothing references this task — it stands on its own
          {task.task_kind === 'recurring' ? ' on the rolling schedule' : ''}.
        </p>
      )}

      <ul className="task-refby-list">
        {data.project && (
          <li>
            <span className="task-refby-tag">Project</span>
            <span className="task-refby-name">
              📋 <RecordLink to={{ kind: 'project', id: data.project.project_id }}>{data.project.name}</RecordLink>
            </span>
            <span className="task-refby-sub">{data.project.status}</span>
            <button
              type="button" className="step-delete" title="Take this task off that project (the task itself stays)"
              onClick={async () => {
                if (await confirm({
                  title: `Take "${task.task_name}" off "${data.project!.name}"?`,
                  message: 'The task goes back to the rolling schedule. Nothing else changes.',
                  confirmLabel: 'Take it off',
                  cancelLabel: 'Leave it',
                })) {
                  setNote(null)
                  setTaskProject.mutate({ taskId: task.task_id, projectId: null },
                    { onSuccess: () => setNote(`Off ${data.project!.name}.`) })
                }
              }}
            >
              ✕
            </button>
          </li>
        )}

        {data.parent && (
          <li>
            <span className="task-refby-tag">Step of</span>
            <button type="button" className="link-button task-refby-name"
              onClick={() => onNavigateToTask(data.parent!.task_id)}>
              {KIND_ICON[data.parent.task_kind] ?? '•'} {data.parent.task_name}
            </button>
            <span className="task-refby-sub">not on its own schedule</span>
            <button
              type="button" className="step-delete" title="Make it a standalone task again"
              onClick={async () => {
                if (await confirm({
                  title: `Pull "${task.task_name}" out of "${data.parent!.task_name}"?`,
                  message: 'It becomes a standalone task on the rolling schedule again. Its history is kept.',
                  confirmLabel: 'Make it standalone',
                  cancelLabel: 'Leave it as a step',
                })) {
                  setNote(null)
                  setTaskParent.mutate({ taskId: task.task_id, parentTaskId: null },
                    { onSuccess: () => setNote('Now a standalone task.') })
                }
              }}
            >
              ✕
            </button>
          </li>
        )}

        {data.links.map((l) => (
          <li key={l.ref_id}>
            <span className="task-refby-tag">
              {l.from_task_kind === 'checklist' ? 'In checklist' : 'Linked from'}
            </span>
            <button type="button" className="link-button task-refby-name"
              onClick={() => onNavigateToTask(l.from_task_id)}>
              {KIND_ICON[l.from_task_kind] ?? '•'} {l.from_task_name}
            </button>
            {l.from_parent_name && (
              <span className="task-refby-sub">
                a step of{' '}
                <RecordLink to={l.from_parent_task_id ? { kind: 'task', id: l.from_parent_task_id } : null}>
                  {l.from_parent_name}
                </RecordLink>
              </span>
            )}
            <button
              type="button" className="step-delete"
              title="Remove just this link (the task itself, and its history, stay)"
              onClick={async () => {
                if (await confirm({
                  title: `Remove the link from "${l.from_task_name}"?`,
                  message: 'Only the link goes. The task itself, and its history, are not touched.',
                  confirmLabel: 'Remove the link',
                  cancelLabel: 'Keep it',
                })) {
                  setNote(null)
                  deleteRef.mutate(l.ref_id, { onSuccess: () => setNote(`Unlinked from ${l.from_task_name}.`) })
                }
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {data.steps.length > 0 && (
        <p className="mgmt-status task-refby-steps">
          Has {data.steps.length} step{data.steps.length === 1 ? '' : 's'} of its own — a delete
          would take {data.steps.length === 1 ? 'it' : 'them'} too.
        </p>
      )}

      <HistoryLine history={data.history} />

      {/* A retired task is done with - un-retire it first, then place it. */}
      <div className="task-refby-add">
        {!data.retired_at && !data.project && (
          <select
            value="" disabled={setTaskProject.isPending}
            title="Put this task on a project"
            onChange={(e) => {
              if (!e.target.value) return
              if (e.target.value === NEW) { setNote(null); setCreating('project'); return }
              const p = (projects ?? []).find((x) => x.project_id === Number(e.target.value))
              putOnProject(Number(e.target.value), p?.name ?? 'the project')
            }}
          >
            <option value="">＋ Add as a step to a project…</option>
            <option value={NEW}>＋ New project…</option>
            {[...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
          </select>
        )}

        {!data.retired_at && task.task_kind !== 'checklist' && !pendingChecklist && (
          <select
            value="" disabled={addRef.isPending || setTaskParent.isPending}
            title="Put this task into a checklist as one of its steps"
            onChange={(e) => {
              if (e.target.value === NEW) { setNote(null); setCreating('checklist'); return }
              const c = choices.find((x) => x.task_id === Number(e.target.value))
              if (c) chooseChecklist(c)
            }}
          >
            <option value="">＋ Add as a step to a checklist…</option>
            <option value={NEW}>＋ New checklist…</option>
            {choices.map((c) => <option key={c.task_id} value={c.task_id}>{c.task_name}</option>)}
          </select>
        )}
      </div>

      {creating === 'project' && (
        <NameBox
          placeholder="New project name" busy={createProject.isPending}
          error={createProject.isError ? errorText(createProject.error) : null}
          onDone={newProject} onCancel={() => setCreating(null)}
        />
      )}
      {creating === 'checklist' && (
        <NameBox
          placeholder="New checklist name" busy={createChecklist.isPending}
          error={createChecklist.isError ? errorText(createChecklist.error) : null}
          onDone={newChecklist} onCancel={() => setCreating(null)}
        />
      )}

      {pendingChecklist && (
        <div className="task-refby-question">
          <p>
            Adding to{' '}
            <strong>
              <RecordLink to={{ kind: 'task', id: pendingChecklist.task_id }}>{pendingChecklist.task_name}</RecordLink>
            </strong>. Keep it on its own schedule too?
          </p>
          <div className="task-refby-question-buttons">
            <button type="button" disabled={addRef.isPending} onClick={() => linkInto(pendingChecklist)}>
              Yes - keep its own schedule
            </button>
            <button type="button" disabled={setTaskParent.isPending} onClick={() => moveInto(pendingChecklist)}>
              No - only with this checklist
            </button>
            <button type="button" className="link-button" onClick={() => setPendingChecklist(null)}>
              Cancel
            </button>
          </div>
          <p className="mgmt-status">
            <strong>Yes:</strong> it stays due on its own and also shows in the checklist - ticking it
            there counts as doing it. <strong>No:</strong> it comes off the rolling schedule and only
            comes up when you run {pendingChecklist.task_name}.
          </p>
        </div>
      )}

      {note && <p className="mgmt-status">{note}</p>}
      {addRef.isError && <p className="mgmt-status mgmt-status--error">{errorText(addRef.error)}</p>}
      {setTaskParent.isError && <p className="mgmt-status mgmt-status--error">{errorText(setTaskParent.error)}</p>}
    </div>
  )
}

/** One-line "new …" name box (Enter to create, Escape to back out) - not a <form>, it lives in one. */
function NameBox({
  placeholder, busy, error, onDone, onCancel,
}: {
  placeholder: string
  busy: boolean
  error: string | null
  onDone: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const submit = () => { if (name.trim() && !busy) onDone(name.trim()) }
  return (
    <div className="system-picker-new">
      <input
        autoFocus placeholder={placeholder} value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
      />
      <button type="button" onClick={submit} disabled={!name.trim() || busy}>✓</button>
      <button type="button" onClick={onCancel}>✕</button>
      {error && <span className="mgmt-status mgmt-status--error">{error}</span>}
    </div>
  )
}

/** What this task's own history is, phrased as what a delete would cost. */
function HistoryLine({ history }: { history: Referenced['history'] }) {
  if (history.can_delete) {
    return <p className="mgmt-status task-refby-history">No logged history yet — safe to delete outright.</p>
  }
  const parts: string[] = []
  if (history.completions) parts.push(`${history.completions} logged completion${history.completions === 1 ? '' : 's'}`)
  if (history.stock_movements) parts.push(`${history.stock_movements} stock movement${history.stock_movements === 1 ? '' : 's'}`)
  return (
    <p className="mgmt-status task-refby-history">
      📗 {parts.join(' and ')}
      {history.descendants ? ` across this task and its ${history.descendants} step(s)` : ''}.
      Retire it rather than delete it, so the maintenance log keeps its thread back to the job.
    </p>
  )
}
