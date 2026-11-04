/**
 * Purpose: A task's full record - the edit form (name, system, description, caution notes,
 *   interval, kind, critical), its steps/needs/references, and the Save + Retire-or-Delete
 *   action row.
 * Version: v4 (2026-09-24) - v4: an hrs task picks its hour meter (engine / generator, named from
 *   Settings) - release package. v3 (2026-09-23) - v3 (tracker #74): the checklist a task runs ("▶ <checklist>") opens
 *   that checklist. v2 (2026-09-22) - v2: a follow-on task (schema v34) shows the history entry that
 *   raised it. v1 (2026-09-22) - first header. Tracker #66: PlacementControls (the Project and
 *   Parent-checklist pickers) and TaskInChecklists were folded into one TaskReferencedBy
 *   panel, and the action row now offers Retire rather than Delete for any task with logged
 *   history, with both confirms spelling out what actually happens.
 * Scope: PRODUCTION - mx-inv frontend, management feature.
 * Architecture: Rendered inside a FocusScreen by ManagementView, ProjectsView and Schedule's
 *   "Open full record", so this one screen is the task editor everywhere. Reads useTasks /
 *   useSystems / useTaskReferencedBy; writes through management/mutations. Child panels:
 *   ChecklistSteps (checklists), TaskNeeds, ChecklistTrigger, TaskReferencedBy, TaskReferences.
 */
import { useEffect, useState } from 'react'
import type { RawTask, TaskReferencedBy as TaskReferencedByData } from '../../api/types'
import { useSettings } from '../../api/settings'
import {
  useCompleteStep,
  useDeleteTask,
  useFinishChecklistRun,
  useRetireTask,
  useUpdateTask,
  type TaskEditFields,
} from './mutations'
import { useSystems, useTasks, useTaskReferencedBy, useTaskReferences } from './useTasks'
import { ChecklistSteps } from './ChecklistSteps'
import { TaskReferences } from './TaskReferences'
import { TaskReferencedBy } from './TaskReferencedBy'
import { TaskNeeds } from './TaskNeeds'
import { SystemPicker } from './SystemPicker'
import { CHECKLISTS_SYSTEM } from './housekeeping'
import { useConfirm } from '../../components/ConfirmDialog'
import { FollowOnOrigin } from '../schedule/TaskCardDetail'
import { RecordLink } from '../../components/RecordLink'

const INTERVAL_TYPES = ['days', 'hrs', 'use', 'break_fix']
const TASK_KINDS = ['recurring', 'one_off', 'checklist']

export function TaskDetail({
  task, onClose, onNavigateToTask, onOpenSystem,
}: {
  task: RawTask
  onClose: () => void
  onNavigateToTask: (taskId: number) => void
  /** When given, the System field gets a link to that system's / device's own screen. */
  onOpenSystem?: (name: string) => void
}) {
  const [fields, setFields] = useState<TaskEditFields>(() => fromTask(task))
  const { data: settings } = useSettings()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const retireTask = useRetireTask()
  const confirm = useConfirm()
  const { data: allTasks } = useTasks()
  const { data: systems } = useSystems()
  // Drives which exit the action row offers: a task with logged history can only be
  // retired (tracker #66). Undefined while loading - treated as "not yet safe to
  // delete", so the dangerous button is never the one shown by default.
  const { data: refby } = useTaskReferencedBy(task.task_id)
  const canDelete = refby?.history.can_delete === true
  const isRetired = !!task.retired_at

  // task identity changes when the selection changes - reset the local
  // edit buffer rather than merging stale edits into the newly-selected task.
  useEffect(() => setFields(fromTask(task)), [task.task_id])

  const set = <K extends keyof TaskEditFields>(key: K, value: TaskEditFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  const save = () => updateTask.mutate({ taskId: task.task_id, fields })

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <h2>Edit task</h2>
        <button type="button" onClick={onClose}>✕ Close</button>
      </div>
      {task.origin_completion_id != null && <FollowOnOrigin row={task} />}

      <label>
        Name
        <input value={fields.task_name ?? ''} onChange={(e) => set('task_name', e.target.value)} />
      </label>

      <SystemPicker
        value={fields.system ?? task.system}
        systems={systems ?? []}
        onChange={(name) => set('system', name)}
      />
      {onOpenSystem && task.system !== CHECKLISTS_SYSTEM && (
        <button
          type="button" className="link-button task-open-system"
          // the SAVED system - an unsaved pick may not be where the task lives yet
          onClick={() => onOpenSystem(task.system)}
        >
          Open {task.system} → (its devices, tasks and parts)
        </button>
      )}

      <label>
        Description
        <textarea
          rows={3}
          value={fields.task_description ?? ''}
          onChange={(e) => set('task_description', e.target.value)}
        />
      </label>

      <label>
        Caution notes
        <textarea
          rows={2}
          value={fields.caution_notes ?? ''}
          onChange={(e) => set('caution_notes', e.target.value)}
        />
      </label>

      <div className="task-detail-row">
        <label>
          Interval type
          <select
            value={fields.interval_type}
            onChange={(e) => set('interval_type', e.target.value)}
          >
            {INTERVAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label>
          Period
          <input value={fields.period ?? ''} onChange={(e) => set('period', e.target.value)} />
        </label>

        {fields.interval_type === 'hrs' && (
          <label>
            Hour meter
            <select
              value={fields.hours_meter ?? 'engine'}
              onChange={(e) => set('hours_meter', e.target.value)}
            >
              <option value="engine">{settings?.engine_label ?? 'Main engine'}</option>
              <option value="genset">{settings?.genset_label ?? 'Generator'}</option>
            </select>
          </label>
        )}
      </div>

      <div className="task-detail-row">
        <label>
          Task kind
          <select value={fields.task_kind} onChange={(e) => set('task_kind', e.target.value)}>
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={!!fields.is_critical}
            onChange={(e) => set('is_critical', e.target.checked)}
          />
          Critical
        </label>
      </div>

      <div className="task-detail-actions">
        <button type="button" onClick={save} disabled={updateTask.isPending}>
          {updateTask.isPending ? 'Saving…' : '💾 Save'}
        </button>
        {!isRetired && (canDelete ? (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (await confirm({
                title: `Delete "${task.task_name}"?`,
                message: deleteMessage(refby),
                confirmLabel: 'Delete task',
              })) {
                deleteTask.mutate(task.task_id, { onSuccess: onClose })
              }
            }}
            disabled={deleteTask.isPending}
          >
            🗑 Delete
          </button>
        ) : (
          <button
            type="button"
            className="danger"
            title="This task has logged history - retiring keeps the maintenance log threaded to it"
            onClick={async () => {
              if (await confirm({
                title: `Retire "${task.task_name}"?`,
                message: retireMessage(refby),
                confirmLabel: 'Retire it',
                cancelLabel: 'Keep it active',
              })) {
                retireTask.mutate({ taskId: task.task_id, reason: null }, { onSuccess: onClose })
              }
            }}
            disabled={retireTask.isPending || !refby}
          >
            📦 Retire
          </button>
        ))}
      </div>

      {task.task_kind === 'checklist' && (
        <ChecklistSteps checklistId={task.task_id} onOpenStep={onNavigateToTask} />
      )}

      {task.task_kind !== 'checklist' && <TaskNeeds taskId={task.task_id} canEdit />}

      {task.task_kind !== 'checklist' && <ChecklistTrigger task={task} />}

      <TaskReferencedBy task={task} onNavigateToTask={onNavigateToTask} />

      <TaskReferences taskId={task.task_id} allTasks={allTasks ?? []} onNavigateToTask={onNavigateToTask} />
    </div>
  )
}

// A periodic (recurring/one_off/break_fix) task whose real job is "remind
// me to run this checklist" - same underlying mechanism as
// IncludedChecklists (a kind='task' reference to a checklist), just
// interpreted differently because the SOURCE here isn't itself a
// checklist. the owner's ask: "set up recurring tasks that invoke a checklist."
// No new schema, no new "add" UI - the trigger link is created the same
// way as any other reference, via TaskReferences' own "+ Add reference"
// form further down this page.
function ChecklistTrigger({ task }: { task: RawTask }) {
  const { data: refs } = useTaskReferences(task.task_id)
  const finishRun = useFinishChecklistRun()
  const completeTrigger = useCompleteStep()
  const [justRan, setJustRan] = useState<number | null>(null)

  const triggers = (refs ?? []).filter((r) => r.kind === 'task' && r.ref_task_kind === 'checklist')
  if (triggers.length === 0) return null

  const busy = finishRun.isPending || completeTrigger.isPending

  return (
    <div className="checklist-trigger">
      <h4>Runs a checklist</h4>
      {triggers.map((r) => (
        <div key={r.ref_id} className="checklist-trigger-row">
          <span>▶ <RecordLink to={r.ref_task_id ? { kind: 'task', id: r.ref_task_id } : null}>{r.ref_task_name}</RecordLink></span>
          {justRan === r.ref_id ? (
            <span className="checklist-trigger-done">✅ Logged and rescheduled</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                finishRun.mutate(r.ref_task_id!, {
                  onSuccess: () => {
                    completeTrigger.mutate(task.task_id, {
                      onSuccess: () => setJustRan(r.ref_id),
                    })
                  },
                })
              }}
            >
              {busy ? 'Running…' : '✅ Run it + mark this done'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Spell out what a delete takes with it, instead of "This cannot be undone." */
function deleteMessage(refby: TaskReferencedByData | undefined): string {
  if (!refby) return 'This cannot be undone.'
  const bits: string[] = []
  const refs = (refby.project ? 1 : 0) + (refby.parent ? 1 : 0) + refby.links.length
  if (refs) bits.push(`${refs} reference${refs === 1 ? '' : 's'} to it`)
  if (refby.steps.length) bits.push(`its ${refby.steps.length} step${refby.steps.length === 1 ? '' : 's'}`)
  return bits.length
    ? `This also removes ${bits.join(' and ')}. It has no logged history, so nothing is lost from the maintenance log. This cannot be undone.`
    : 'It has no logged history and nothing references it. This cannot be undone.'
}

/** Why retire rather than delete, in the numbers for THIS task. */
function retireMessage(refby: TaskReferencedByData | undefined): string {
  if (!refby) return 'Loading…'
  const h = refby.history
  const parts: string[] = []
  if (h.completions) parts.push(`${h.completions} logged completion${h.completions === 1 ? '' : 's'}`)
  if (h.stock_movements) parts.push(`${h.stock_movements} stock movement${h.stock_movements === 1 ? '' : 's'}`)
  return `It comes off the schedule and out of every pick list, but the task itself stays so its ${parts.join(' and ')} stay attached to it in the maintenance log. You can un-retire it any time.`
}

function fromTask(task: RawTask): TaskEditFields {
  return {
    system: task.system,
    task_name: task.task_name,
    task_description: task.task_description ?? '',
    caution_notes: task.caution_notes ?? '',
    period: task.period ?? '',
    interval_type: task.interval_type,
    task_kind: task.task_kind,
    is_critical: !!task.is_critical,
    hours_meter: task.hours_meter,
  }
}
