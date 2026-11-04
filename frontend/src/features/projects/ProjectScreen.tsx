/**
 * Purpose: The project focus screen body - editable project fields, its task
 *   list (clicking a task opens the full-screen task editor owned by
 *   ProjectsView), and the "new task" / "add existing tasks" controls.
 * Version: v4 (2026-09-23)
 *   - v4: a task row's phase pick is always shown (PhasePick from NewProjectTaskForm) with
 *     "＋ New phase…" first - the phase is created inline and the task moved into it (tracker #76).
 *   - v3: a task row's system chip opens the device and the task name opens the task editor -
 *     two targets, no longer one button (tracker #74).
 * Scope: PRODUCTION - mx-inv frontend, projects feature.
 * Architecture: Rendered inside <FocusScreen> by ProjectsView.tsx (which owns
 *   the back trail). Was the inline-expanded ProjectEditor in ProjectCard.tsx
 *   before the 2026-09-18 focus-screen conversion. v2: the task list is grouped
 *   by the project's PHASES (schema v23: an ordered per-project stage list, see
 *   PhaseHeader.tsx) with a "No phase" group last; the old free-text phase tag
 *   (tasks.checklist_group, really a work area) is no longer shown here. The
 *   two child forms live in NewProjectTaskForm.tsx and AddExistingTasks.tsx.
 */
import { useState } from 'react'
import type {
  Project, ProjectKind, ProjectPhase, ProjectStatus, ProjectTaskRow, RawTask,
} from '../../api/types'
import { PROJECT_KINDS, PROJECT_STATUSES } from '../../api/types'
import { useProjectPhases, useProjectTasks } from './useProjects'
import {
  errorText, useDeleteProject, useReorderPhases, useSetTaskPhase, useSetTaskProject,
  useUpdateProject, type ProjectEditFields,
} from './mutations'
import { useCompleteStep, useUncompleteStep, useUpdateTask } from '../management/mutations'
import { moved, reorderPatches } from '../management/reorder'
import { KIND_ICON } from './projectIcons'
import { AddPhaseForm, PhaseHeader } from './PhaseHeader'
import { NewProjectTaskForm, PhasePick } from './NewProjectTaskForm'
import { AddExistingTasks } from './AddExistingTasks'
import { useConfirm } from '../../components/ConfirmDialog'
import { SystemTaskLabel } from '../../components/RecordLink'

const TASK_KIND_ICON: Record<string, string> = { checklist: '✅', recurring: '🛠️', one_off: '🛠️' }

export function ProjectScreen({
  project, allTasks, onOpenTask, onDeleted,
}: {
  project: Project
  allTasks: RawTask[]
  onOpenTask: (taskId: number) => void
  onDeleted: () => void
}) {
  const [fields, setFields] = useState<ProjectEditFields>(() => fromProject(project))
  const [justSaved, setJustSaved] = useState(false)
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const confirm = useConfirm()
  const { data: tasks } = useProjectTasks(project.project_id)
  const { data: phasesData } = useProjectPhases(project.project_id)
  const phases = phasesData ?? []
  const reorderPhases = useReorderPhases()
  const setTaskProject = useSetTaskProject()
  const updateTask = useUpdateTask()

  const set = <K extends keyof ProjectEditFields>(key: K, value: ProjectEditFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  const unassigned = allTasks.filter((t) => t.project_id === null && t.parent_task_id === null)

  // Order a task within its own group (phase or "No phase"); the group order
  // is what the screen shows, so renumbering inside the group is enough.
  const moveTask = (group: ProjectTaskRow[], index: number, direction: 'up' | 'down') => {
    const next = moved(group, index, direction)
    for (const patch of reorderPatches(next)) {
      updateTask.mutate({ taskId: patch.task_id, fields: { sort_order: patch.sort_order } })
    }
  }

  const movePhase = (index: number, direction: 'up' | 'down') => {
    const next = moved(phases, index, direction)
    reorderPhases.mutate({ projectId: project.project_id, phaseIds: next.map((p) => p.phase_id) })
  }

  const taskList = (group: ProjectTaskRow[]) => (
    <ul className="project-tasks-list">
      {group.map((t, index) => (
        <ProjectTaskItem
          key={t.task_id}
          projectId={project.project_id}
          task={t}
          phases={phases}
          onOpen={() => onOpenTask(t.task_id)}
          onRemove={async () => {
            if (await confirm({
              title: `Take "${t.task_name}" off this project?`,
              message: 'The task itself is kept; it just no longer belongs to the project.',
              confirmLabel: 'Remove from project',
            })) setTaskProject.mutate({ taskId: t.task_id, projectId: null })
          }}
          onMoveUp={index > 0 ? () => moveTask(group, index, 'up') : undefined}
          onMoveDown={index < group.length - 1 ? () => moveTask(group, index, 'down') : undefined}
        />
      ))}
    </ul>
  )

  const noPhase = (tasks ?? []).filter((t) => t.phase_id === null)

  return (
    <div className="project-editor">
      <h3 className="project-screen-title">{KIND_ICON[project.kind]} {project.name}</h3>
      <div className="project-editor-row">
        <label>
          Name
          <input value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Kind
          <select value={fields.kind} onChange={(e) => set('kind', e.target.value as ProjectKind)}>
            {PROJECT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={fields.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="project-editor-row">
        <label>
          Target start
          <input type="date" value={fields.target_start ?? ''} onChange={(e) => set('target_start', e.target.value || null)} />
        </label>
        <label>
          Target end
          <input type="date" value={fields.target_end ?? ''} onChange={(e) => set('target_end', e.target.value || null)} />
        </label>
      </div>
      <label>
        Notes
        <textarea rows={2} value={fields.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>

      {(fields.status === 'planned' || fields.status === 'cancelled') && project.open_count > 0 && (
        <p className="project-parked-note">
          🅿️ {project.open_count} task(s) parked — hidden from the rolling schedule until this
          project is <strong>active</strong>.
        </p>
      )}

      <div className="project-editor-actions">
        <button
          type="button"
          onClick={() => {
            setJustSaved(false)
            updateProject.mutate(
              { projectId: project.project_id, fields },
              { onSuccess: () => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) } },
            )
          }}
          disabled={updateProject.isPending}
        >
          {updateProject.isPending ? 'Saving…' : justSaved ? '✓ Saved' : '💾 Save project'}
        </button>
        {updateProject.isError && (
          <span className="mgmt-status mgmt-status--error">
            Save failed: {(updateProject.error as Error).message}
          </span>
        )}
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (await confirm({
              title: `Delete project "${project.name}"?`,
              message: 'Its tasks are released, not deleted.',
              confirmLabel: 'Delete project',
            })) {
              deleteProject.mutate(project.project_id, { onSuccess: onDeleted })
            }
          }}
        >
          🗑 Delete
        </button>
      </div>

      <h4>{phases.length > 0 ? 'Plan — tasks by phase' : 'Tasks on this project'}</h4>
      {reorderPhases.isError && (
        <p className="mgmt-status mgmt-status--error">{errorText(reorderPhases.error)}</p>
      )}
      {phases.length === 0 && (
        <p className="mgmt-status">
          No phases yet - add some (e.g. Haul-out, Yard work, Pre-splash, Splash, Sea trial) to
          break this project into stages.
        </p>
      )}
      {phases.map((phase, index) => {
        const group = (tasks ?? []).filter((t) => t.phase_id === phase.phase_id)
        return (
          <section key={phase.phase_id} className="phase-group">
            <PhaseHeader
              phase={phase}
              onMoveUp={index > 0 ? () => movePhase(index, 'up') : undefined}
              onMoveDown={index < phases.length - 1 ? () => movePhase(index, 'down') : undefined}
            />
            {group.length === 0 ? <p className="project-tasks-empty">No tasks in this phase.</p> : taskList(group)}
          </section>
        )
      })}
      {phases.length > 0 && noPhase.length > 0 && (
        <section className="phase-group">
          <h4 className="phase-title phase-title--none">No phase</h4>
          {taskList(noPhase)}
        </section>
      )}
      {phases.length === 0 && (
        !tasks || tasks.length === 0
          ? <p className="project-tasks-empty">None yet.</p>
          : taskList(noPhase)
      )}
      <AddPhaseForm projectId={project.project_id} />

      <NewProjectTaskForm projectId={project.project_id} phases={phases} />
      <AddExistingTasks projectId={project.project_id} unassigned={unassigned} />
    </div>
  )
}

function ProjectTaskItem({
  projectId, task, phases, onOpen, onRemove, onMoveUp, onMoveDown,
}: {
  projectId: number
  task: ProjectTaskRow
  phases: ProjectPhase[]
  onOpen: () => void
  onRemove: () => void | Promise<void>
  onMoveUp: (() => void) | undefined
  onMoveDown: (() => void) | undefined
}) {
  const completeTask = useCompleteStep()
  const uncompleteTask = useUncompleteStep()
  const setPhase = useSetTaskPhase()
  const isChecklist = task.task_kind === 'checklist'

  return (
    <li>
      <div className="project-task-row">
        <span className="step-reorder">
          <button type="button" title="Move up" disabled={!onMoveUp} onClick={onMoveUp}>▲</button>
          <button type="button" title="Move down" disabled={!onMoveDown} onClick={onMoveDown}>▼</button>
        </span>
        {!isChecklist && (
          <input
            type="checkbox"
            title={task.done ? 'Mark not complete' : 'Mark complete'}
            checked={!!task.done}
            disabled={completeTask.isPending || uncompleteTask.isPending}
            onChange={() =>
              task.done ? uncompleteTask.mutate(task.task_id) : completeTask.mutate(task.task_id)
            }
          />
        )}
        {/* System and task are two targets (tracker #74): the chip opens the device, the task
            name opens this tab's full-screen task editor. */}
        <span className="project-task-toggle">
          <span className="project-task-caret">›</span>
          {TASK_KIND_ICON[task.task_kind] ?? '🛠️'}{' '}
          <SystemTaskLabel system={task.system} taskId={task.task_id} taskName={task.task_name} onOpenTask={onOpen} />
        </span>
        <span className="phase-pick-cell" title="Phase">
          <PhasePick
            projectId={projectId} phases={phases} value={task.phase_id ?? null}
            disabled={setPhase.isPending}
            onPick={(phaseId) => setPhase.mutate({ taskId: task.task_id, phaseId })}
          />
        </span>
        <button type="button" title="Remove from project" onClick={onRemove}>✕</button>
      </div>
      {setPhase.isError && (
        <span className="mgmt-status mgmt-status--error">{errorText(setPhase.error)}</span>
      )}
    </li>
  )
}

function fromProject(p: Project): ProjectEditFields {
  return {
    name: p.name,
    kind: p.kind,
    status: p.status,
    target_start: p.target_start,
    target_end: p.target_end,
    notes: p.notes ?? '',
  }
}
