import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../api/client'
import { todayLocal } from '../../api/date'

// Any task/checklist edit can change what the schedule board shows (period,
// interval_type, is_critical, completion...) so every mutation here
// invalidates 'tasks', 'schedule' and every 'subtasks' query rather than
// trying to patch three different shapes of cached state in sync.
// TData is inferred from `fn`, so a mutation whose response is worth reading (the clone
// summary, for one) gets a typed `onSuccess` instead of `unknown`.
function useTaskMutation<TVars, TData = unknown>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['subtasks'] })
      queryClient.invalidateQueries({ queryKey: ['checklist-items'] })
      queryClient.invalidateQueries({ queryKey: ['checklist-groups'] })
      queryClient.invalidateQueries({ queryKey: ['importable-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['task-references'] })
      queryClient.invalidateQueries({ queryKey: ['task-linked-from'] })
      queryClient.invalidateQueries({ queryKey: ['task-referenced-by'] })
      queryClient.invalidateQueries({ queryKey: ['task-items-demand'] })
      queryClient.invalidateQueries({ queryKey: ['linkable-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['systems'] })
      queryClient.invalidateQueries({ queryKey: ['system-items'] })
    },
  })
}

export interface NewSystem {
  name: string
  parent_name?: string | null
  sort_order?: number | null
  notes?: string | null
}

export function useCreateSystem() {
  return useTaskMutation((body: NewSystem) => apiSend('POST', '/tasks/systems', body))
}

export interface SystemUpdateFields {
  parent_name?: string | null
  sort_order?: number | null
  notes?: string | null
  // device details (schema v22) - the backend validates them
  make_model?: string | null
  manual_ref?: string | null
  installed_qty?: number
  no_spares_needed?: boolean
  // device identity (schema v32) - dates are validated server-side as YYYY-MM-DD.
  // A field left out of BOTH this type and the backend's SystemUpdate model is dropped
  // silently and the PATCH still answers 200, so the two must be kept in step.
  installed_on?: string | null
  serial?: string | null
  warranty_until?: string | null
}

export function useUpdateSystem() {
  return useTaskMutation(({ name, fields }: { name: string; fields: SystemUpdateFields }) =>
    apiSend('PATCH', `/tasks/systems/${encodeURIComponent(name)}`, fields),
  )
}

export function useRenameSystem() {
  return useTaskMutation(({ name, newName }: { name: string; newName: string }) =>
    apiSend('POST', `/tasks/systems/${encodeURIComponent(name)}/rename`, { new_name: newName }),
  )
}

// Tracker #67: duplicate a fully set-up device (details + part links + its own
// independent copies of its tasks) under a new name. Returns a summary of what was
// copied and what was skipped.
export interface CloneSystemSummary {
  source: string
  new_name: string
  parts_linked: number
  tasks_copied: number
  task_items_copied: number
  references_copied: number
  steps_skipped: number
  renamed_in_titles: number
}

export function useCloneSystem() {
  return useTaskMutation(({ name, newName }: { name: string; newName: string }) =>
    apiSend<CloneSystemSummary>('POST', `/tasks/systems/${encodeURIComponent(name)}/clone`,
      { new_name: newName }),
  )
}

export function useDeleteSystem() {
  return useTaskMutation(({ name, reassignTo }: { name: string; reassignTo?: string | null }) =>
    apiSend('POST', `/tasks/systems/${encodeURIComponent(name)}/delete`, { reassign_to: reassignTo ?? null }),
  )
}

export interface NewTaskReference {
  taskId: number
  kind: string
  label: string
  file_path?: string | null
  page?: number | null
  url?: string | null
  note?: string | null
  ref_task_id?: number | null
}

export function useAddTaskReference() {
  return useTaskMutation(({ taskId, ...body }: NewTaskReference) =>
    apiSend('POST', `/tasks/${taskId}/references`, body),
  )
}

// Per-run tick of a task linked into a checklist (schema v27): a real completion of the linked
// task, remembered on the link; un-tick voids it (the linked task's last-done date goes back).
// consumption (tracker #64): stock is drawn ONLY for what is passed here, same as
// completing a task from its own screen - the caller must ask explicitly.
export function useTickChecklistLink() {
  return useTaskMutation(
    ({ refId, consumption }: { refId: number; consumption?: { item_id: number; quantity: number }[] }) =>
      apiSend('POST', `/tasks/references/${refId}/tick`, {
        completed_on: todayLocal(),
        consumption: consumption && consumption.length ? consumption : null,
      }),
  )
}

export function useUntickChecklistLink() {
  return useTaskMutation((refId: number) => apiSend('POST', `/tasks/references/${refId}/untick`))
}

// A link's own place in the checklist (sort_order) and sub-list group.
export function useUpdateTaskReference() {
  return useTaskMutation(
    ({ refId, fields }: { refId: number; fields: { sort_order?: number; checklist_group?: string | null } }) =>
      apiSend('PATCH', `/tasks/references/${refId}`, fields),
  )
}

// A task's parts / tools / supplies (task_items). Information only - nothing here draws stock.
export function useSetTaskItem() {
  return useTaskMutation(
    ({ taskId, itemId, quantity_required, amount_note }: {
      taskId: number; itemId: number; quantity_required: number; amount_note: string | null
    }) => apiSend('PUT', `/tasks/${taskId}/items/${itemId}`, { quantity_required, amount_note }),
  )
}

export function useRemoveTaskItem() {
  return useTaskMutation(({ taskId, itemId }: { taskId: number; itemId: number }) =>
    apiSend('DELETE', `/tasks/${taskId}/items/${itemId}`),
  )
}

export function useDeleteTaskReference() {
  return useTaskMutation((refId: number) => apiSend('DELETE', `/tasks/references/${refId}`))
}

export interface TaskEditFields {
  system?: string
  task_name?: string
  task_description?: string
  caution_notes?: string
  period?: string
  interval_type?: string
  task_kind?: string
  is_critical?: boolean
  hours_meter?: string | null
  checklist_group?: string | null
  sort_order?: number
}

export function useUpdateTask() {
  return useTaskMutation(({ taskId, fields }: { taskId: number; fields: TaskEditFields }) =>
    apiSend('PATCH', `/tasks/${taskId}`, fields),
  )
}

export function useDeleteTask() {
  return useTaskMutation((taskId: number) => apiSend('DELETE', `/tasks/${taskId}`))
}

// Retire = off the schedule and out of the pick lists, master row kept so the MX log
// stays threaded to it (tracker #66). Reversible; hard delete is not.
export function useRetireTask() {
  return useTaskMutation(({ taskId, reason }: { taskId: number; reason?: string | null }) =>
    apiSend('POST', `/tasks/${taskId}/retire`, { reason: reason ?? null }),
  )
}

export function useUnretireTask() {
  return useTaskMutation((taskId: number) => apiSend('POST', `/tasks/${taskId}/unretire`, {}))
}

// null releases the task back to standalone (out of any checklist).
export function useSetTaskParent() {
  return useTaskMutation(({ taskId, parentTaskId }: { taskId: number; parentTaskId: number | null }) =>
    apiSend('PUT', `/tasks/${taskId}/parent`, { parent_task_id: parentTaskId }),
  )
}

export interface NewTask {
  system: string
  task_name: string
  description?: string
  period?: string
  interval_type?: string
  task_kind?: string
  caution_notes?: string
}

export function useCreateTask() {
  return useTaskMutation((body: NewTask) => apiSend('POST', '/tasks', body))
}

export interface NewChecklist {
  name: string
  system?: string
  caution_notes?: string
}

export function useCreateChecklist() {
  return useTaskMutation((body: NewChecklist) => apiSend('POST', '/tasks/checklists', body))
}

export interface NewStep {
  checklistId: number
  step_name: string
  description?: string
  group?: string
}

export function useAddChecklistStep() {
  return useTaskMutation(({ checklistId, ...body }: NewStep) =>
    apiSend('POST', `/tasks/${checklistId}/checklist/steps`, body),
  )
}

export function useResetChecklist() {
  return useTaskMutation((checklistId: number) =>
    apiSend('POST', `/tasks/${checklistId}/checklist/reset`),
  )
}

export interface ImportTaskAsStep {
  checklistId: number
  task_id: number
  group?: string
}

export function useImportTaskAsStep() {
  return useTaskMutation(({ checklistId, ...body }: ImportTaskAsStep) =>
    apiSend('POST', `/tasks/${checklistId}/checklist/import`, body),
  )
}

// Copies the task into the checklist as an independent step - the source
// keeps its own periodic schedule untouched (see data.duplicate_task_as_step).
export function useDuplicateTaskAsStep() {
  return useTaskMutation(({ checklistId, ...body }: ImportTaskAsStep) =>
    apiSend('POST', `/tasks/${checklistId}/checklist/duplicate`, body),
  )
}

// Completes the checklist itself (force-closing every open step, per the owner's
// "my mark-complete overrides subtask state") and immediately resets it -
// composes two existing endpoints into the one "I'm done running this"
// action, rather than requiring Complete then Reset as two manual clicks.
export function useFinishChecklistRun() {
  return useTaskMutation(async (checklistId: number) => {
    await apiSend('POST', `/tasks/${checklistId}/complete`, {
      completed_on: todayLocal(),
      close_subtasks: true,
    })
    await apiSend('POST', `/tasks/${checklistId}/checklist/reset`)
  })
}

export function useCompleteStep() {
  return useTaskMutation((taskId: number) =>
    apiSend('POST', `/tasks/${taskId}/complete`, {
      completed_on: todayLocal(),
    }),
  )
}

export function useUncompleteStep() {
  return useTaskMutation((taskId: number) =>
    apiSend('POST', `/tasks/${taskId}/clear-completion`),
  )
}
