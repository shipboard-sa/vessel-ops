/**
 * Purpose: "+ New task for this project" form on the project focus screen -
 *   system (governed picklist) + title + optional description and phase
 *   (a pick list of the project's own phases, schema v23).
 * Version: v4 (2026-09-23)
 *   - v4: the phase pick is always shown (PhasePick, exported here and also used by ProjectScreen's
 *     task rows): type to search, "＋ New phase…" FIRST - name it inline and it comes back
 *     selected (tracker #76).
 *   - v3: the "✓ Created" note keeps the new task's id and its name opens the task (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Child of ProjectScreen.tsx. Moved verbatim out of
 *   ProjectCard.tsx (v2) in the focus-screen conversion; uses Management's
 *   SystemPicker and projects/mutations useCreateProjectTask.
 */
import { useState } from 'react'
import type { ProjectPhase } from '../../api/types'
import { useCreatePhase, useCreateProjectTask } from './mutations'
import { useSystems } from '../management/useTasks'
import { SystemPicker } from '../management/SystemPicker'
import { RecordLink } from '../../components/RecordLink'
import { SearchPick } from '../../components/SearchPick'

export function NewProjectTaskForm({ projectId, phases }: { projectId: number; phases: ProjectPhase[] }) {
  const createTask = useCreateProjectTask()
  const { data: systems } = useSystems()
  const [expanded, setExpanded] = useState(false)
  const [system, setSystem] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [phaseId, setPhaseId] = useState<number | null>(null)
  // The task just created (id from the POST /tasks response) so its name can open it.
  const [created, setCreated] = useState<{ id: number | null; name: string } | null>(null)

  if (!expanded) {
    return (
      <div>
        {created && (
          <p className="mgmt-status">
            ✓ Created "<RecordLink to={created.id ? { kind: 'task', id: created.id } : null}>{created.name}</RecordLink>"
            {' '}- it's in the list above; open it to add more detail.
          </p>
        )}
        <button type="button" className="link-button" onClick={() => { setCreated(null); setExpanded(true) }}>
          + New task for this project
        </button>
      </div>
    )
  }

  const missing = [!system && 'a system', !name.trim() && 'a title'].filter(Boolean).join(' and ')

  return (
    <form
      className="project-new-task"
      onSubmit={(e) => {
        e.preventDefault()
        if (missing) return
        createTask.mutate(
          {
            projectId, system, task_name: name.trim(), task_kind: 'one_off', interval_type: 'break_fix',
            description: description.trim() || undefined,
            ...(phaseId !== null ? { phase_id: phaseId } : {}),
          },
          {
            onSuccess: (res) => {
              setCreated({ id: (res as { task_id?: number } | undefined)?.task_id ?? null, name: name.trim() })
              setSystem(''); setName(''); setDescription(''); setPhaseId(null); setExpanded(false)
            },
          },
        )
      }}
    >
      <h4>New task for this project</h4>
      <SystemPicker value={system} systems={systems ?? []} onChange={setSystem} />
      <label>
        Title
        <input placeholder="Task title" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description (optional)
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="search-pick-field">
        <span>Phase (optional)</span>
        <PhasePick projectId={projectId} phases={phases} value={phaseId} onPick={setPhaseId} />
      </div>
      <div className="project-editor-actions">
        <button type="submit" disabled={!!missing || createTask.isPending}>
          {createTask.isPending ? 'Saving…' : '💾 Save task'}
        </button>
        <button type="button" onClick={() => setExpanded(false)}>Cancel</button>
        {missing && <span className="mgmt-status">Needs {missing}.</span>}
        {createTask.isError && (
          <span className="mgmt-status mgmt-status--error">
            Save failed: {(createTask.error as Error).message}
          </span>
        )}
      </div>
    </form>
  )
}

/** A project's phase pick list: "— no phase —", its phases, and "＋ New phase…" first (created
 *  inline via POST /projects/{id}/phases and selected). Not a <form> - it sits inside forms. */
export function PhasePick({
  projectId, phases, value, onPick, disabled,
}: {
  projectId: number
  phases: ProjectPhase[]
  value: number | null
  onPick: (phaseId: number | null) => void
  disabled?: boolean
}) {
  return (
    <SearchPick<ProjectPhase>
      options={phases}
      keyOf={(p) => p.phase_id}
      labelOf={(p) => p.name}
      value={value}
      onPick={(k) => onPick(k === null ? null : Number(k))}
      placeholder="— no phase —"
      noneLabel="— no phase —"
      disabled={disabled}
      newLabel={(t) => (t ? `＋ New phase “${t}”…` : '＋ New phase…')}
      renderNew={(typed, done, cancel) => (
        <NewPhaseBox projectId={projectId} initialName={typed} onDone={done} onCancel={cancel} />
      )}
    />
  )
}

function NewPhaseBox({
  projectId, initialName, onDone, onCancel,
}: {
  projectId: number
  initialName: string
  onDone: (phaseId: number, name: string) => void
  onCancel: () => void
}) {
  const create = useCreatePhase()
  const [name, setName] = useState(initialName)
  const submit = () => {
    const n = name.trim()
    if (!n) return
    create.mutate({ projectId, name: n }, {
      onSuccess: (res) => onDone((res as { phase_id: number }).phase_id, n),
    })
  }
  return (
    <div className="system-picker-new">
      <input
        autoFocus placeholder="New phase name (e.g. Yard work)" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
      />
      <button type="button" onClick={submit} disabled={!name.trim() || create.isPending}>✓</button>
      <button type="button" onClick={onCancel}>✕</button>
      {create.isError && <span className="mgmt-status mgmt-status--error">{(create.error as Error).message}</span>}
    </div>
  )
}
