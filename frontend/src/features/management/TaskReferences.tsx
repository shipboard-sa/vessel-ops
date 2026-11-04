/**
 * Purpose: A task's "References" list - links to other tasks in the app and to external
 *   manuals / standards / URLs / notes - plus the form to add one.
 * Version: v3 (2026-09-23) - v3 (tracker #76, no-detour): the task target is ONE type-to-search
 *   pick over every live task (hint = its system) instead of a system select then a task select,
 *   with "＋ New task…" as the first row - name + system (defaults to this task's) creates it
 *   right here (POST /tasks) and it is picked.
 *   v2 (2026-09-23) - v2 (tracker #74): a task reference's system chip and task name are
 *   two targets (system opens the device, name opens the task). v1 undated.
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered by TaskDetail. Reads GET /api/tasks/{id}/references (task_references)
 *   via useTaskReferences; adds / deletes through management/mutations.ts. The host passes
 *   onNavigateToTask to open a referenced task on its own trail.
 */
import { useState } from 'react'
import type { RawTask } from '../../api/types'
import { useSystems, useTaskReferences } from './useTasks'
import { useAddTaskReference, useCreateTask, useDeleteTaskReference } from './mutations'
import { SearchPick } from '../../components/SearchPick'
import { SystemPicker } from './SystemPicker'
import { useConfirm } from '../../components/ConfirmDialog'
import { SystemTaskLabel } from '../../components/RecordLink'

const EXTERNAL_KINDS = ['manual', 'standard', 'url', 'video', 'form', 'note'] as const

export function TaskReferences({
  taskId, allTasks, onNavigateToTask,
}: { taskId: number; allTasks: RawTask[]; onNavigateToTask: (taskId: number) => void }) {
  const { data: refs } = useTaskReferences(taskId)
  const deleteRef = useDeleteTaskReference()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)

  return (
    <div className="task-references">
      <div className="task-references-header">
        <h3>References</h3>
        <button type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add reference'}
        </button>
      </div>

      {!refs || refs.length === 0 ? (
        <p className="mgmt-status">No references yet.</p>
      ) : (
        <ul className="task-references-list">
          {refs.map((r) => (
            <li key={r.ref_id}>
              {r.kind === 'task' ? (
                r.ref_task_id != null && r.ref_task_name != null ? (
                  <span className="task-reference-link">
                    <SystemTaskLabel
                      system={r.ref_task_system} taskId={r.ref_task_id} taskName={r.ref_task_name}
                      onOpenTask={() => onNavigateToTask(r.ref_task_id!)}
                    />
                  </span>
                ) : (
                  <span className="task-reference-dangling" title="The referenced task was deleted">
                    ⚠ {r.label} (deleted)
                  </span>
                )
              ) : (
                <span className="task-reference-external">
                  <span className="task-reference-kind">{r.kind}</span>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">{r.label}</a>
                  ) : (
                    <span>{r.label}{r.page ? `, p.${r.page}` : ''}</span>
                  )}
                  {r.note && <span className="task-reference-note"> — {r.note}</span>}
                </span>
              )}
              <button
                type="button"
                className="task-reference-delete"
                title="Delete reference"
                onClick={async () => {
                  if (await confirm({
                    title: `Delete the reference "${r.ref_task_name ?? r.label}"?`,
                    message: 'Only the reference goes; a linked task itself is not touched.',
                    confirmLabel: 'Delete reference',
                  })) deleteRef.mutate(r.ref_id)
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddReferenceForm taskId={taskId} allTasks={allTasks} onDone={() => setAdding(false)} />
      )}
    </div>
  )
}

function AddReferenceForm({
  taskId, allTasks, onDone,
}: { taskId: number; allTasks: RawTask[]; onDone: () => void }) {
  const addRef = useAddTaskReference()
  const [kind, setKind] = useState<string>('task')
  const [targetId, setTargetId] = useState<number | null>(null)
  // a just-created task is not in allTasks until the tasks query refetches
  const [targetName, setTargetName] = useState('')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')

  const ownSystem = allTasks.find((t) => t.task_id === taskId)?.system ?? ''
  const options = allTasks
    .filter((t) => !t.retired && t.task_id !== taskId)
    .sort((a, b) => a.task_name.localeCompare(b.task_name))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (kind === 'task') {
      if (targetId === null) return
      const name = allTasks.find((t) => t.task_id === targetId)?.task_name ?? targetName
      addRef.mutate(
        { taskId, kind: 'task', label: name, ref_task_id: targetId },
        { onSuccess: onDone },
      )
    } else {
      if (!label.trim()) return
      addRef.mutate(
        { taskId, kind, label: label.trim(), url: url.trim() || null, note: note.trim() || null },
        { onSuccess: onDone },
      )
    }
  }

  return (
    <form className="mgmt-inline-form task-reference-form" onSubmit={submit}>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="task">task (in this app)</option>
        {EXTERNAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>

      {kind === 'task' ? (
        <>
          <SearchPick<RawTask>
            options={options}
            keyOf={(t) => t.task_id}
            labelOf={(t) => t.task_name}
            hintOf={(t) => t.system}
            value={targetId}
            onPick={(k, t) => { setTargetId(k === null ? null : Number(k)); if (t) setTargetName(t.task_name) }}
            placeholder="Type a task (or its system)…"
            newLabel={(t) => (t ? `＋ New task “${t}”…` : '＋ New task…')}
            renderNew={(typed, done, cancel) => (
              <NewTaskBox
                initialName={typed} initialSystem={ownSystem}
                onDone={(id, name) => { setTargetName(name); done(id, name) }}
                onCancel={cancel}
              />
            )}
          />
          <button type="submit" disabled={targetId === null || addRef.isPending}>Add</button>
        </>
      ) : (
        <>
          <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input placeholder="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" disabled={!label.trim() || addRef.isPending}>Add</button>
        </>
      )}
    </form>
  )
}

/** Inline "new task" - name + system, Enter to create, Escape to back out (not a <form>: it sits in one). */
function NewTaskBox({
  initialName, initialSystem, onDone, onCancel,
}: {
  initialName: string
  initialSystem: string
  onDone: (taskId: number, name: string) => void
  onCancel: () => void
}) {
  const { data: systems } = useSystems()
  const createTask = useCreateTask()
  const [name, setName] = useState(initialName)
  const [system, setSystem] = useState(initialSystem)
  const canCreate = Boolean(name.trim() && system && !createTask.isPending)
  const submit = () => {
    if (!canCreate) return
    const n = name.trim()
    createTask.mutate({ system, task_name: n }, {
      onSuccess: (res) => onDone((res as { task_id: number }).task_id, n),
    })
  }
  return (
    <div className="recipe-review-new">
      <strong>New task</strong>
      <label>
        Name
        <input
          autoFocus value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
        />
      </label>
      <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
      <button type="button" onClick={submit} disabled={!canCreate}>✓ Create and use</button>
      <button type="button" onClick={onCancel}>✕</button>
      <span className="mgmt-status">Schedule and how-to can be filled in on the task later.</span>
      {createTask.isError && <span className="mgmt-status mgmt-status--error">{(createTask.error as Error).message}</span>}
    </div>
  )
}
