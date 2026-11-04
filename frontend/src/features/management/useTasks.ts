import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type {
  ChecklistItem, LinkableTask, RawTask, SubtaskRow, SystemInfo, SystemItem,
  TaskReference, TaskReferencedBy,
} from '../../api/types'

// GET /tasks/{checklistId}/checklist/importable - (task_id, system,
// task_name) for standalone tasks that could become a step of this
// checklist (not already a subtask of anything, not a checklist itself).
export interface ImportableTask {
  task_id: number
  system: string
  task_name: string
}

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => apiGet<RawTask[]>('/tasks'),
  })
}

export function useSubtasks(taskId: number | null) {
  return useQuery({
    queryKey: ['subtasks', taskId],
    queryFn: () => apiGet<SubtaskRow[]>(`/tasks/${taskId}/subtasks`),
    enabled: taskId !== null,
  })
}

export function useChecklistGroups(checklistId: number | null) {
  return useQuery({
    queryKey: ['checklist-groups', checklistId],
    queryFn: () => apiGet<string[]>(`/tasks/${checklistId}/checklist/groups`),
    enabled: checklistId !== null,
  })
}

export function useImportableTasks(checklistId: number | null) {
  return useQuery({
    queryKey: ['importable-tasks', checklistId],
    queryFn: () => apiGet<ImportableTask[]>(`/tasks/${checklistId}/checklist/importable`),
    enabled: checklistId !== null,
  })
}

// A checklist's own steps AND the tasks linked into it, in one ordered list (schema v27).
export function useChecklistItems(checklistId: number | null) {
  return useQuery({
    queryKey: ['checklist-items', checklistId],
    queryFn: () => apiGet<ChecklistItem[]>(`/tasks/${checklistId}/checklist/items`),
    enabled: checklistId !== null,
  })
}

// Every task that can be LINKED into this checklist, including ones already a step of another
// checklist (tracker #48) - drives the one-box search on the checklist screen.
export function useLinkableTasks(checklistId: number | null) {
  return useQuery({
    queryKey: ['linkable-tasks', checklistId],
    queryFn: () => apiGet<LinkableTask[]>(`/tasks/${checklistId}/checklist/linkable`),
    enabled: checklistId !== null,
  })
}

// Every place a task is spoken for - project, parent checklist, all inbound kind='task'
// links, its own steps, and what its history would cost a delete (tracker #66).
export function useTaskReferencedBy(taskId: number | null) {
  return useQuery({
    queryKey: ['task-referenced-by', taskId],
    queryFn: () => apiGet<TaskReferencedBy>(`/tasks/${taskId}/referenced-by`),
    enabled: taskId !== null,
  })
}

export function useTaskReferences(taskId: number | null) {
  return useQuery({
    queryKey: ['task-references', taskId],
    queryFn: () => apiGet<TaskReference[]>(`/tasks/${taskId}/references`),
    enabled: taskId !== null,
  })
}

// A device's parts and spare units (items linked to it), with on-hand.
export function useSystemItems(name: string | null) {
  return useQuery({
    queryKey: ['system-items', name],
    queryFn: () => apiGet<SystemItem[]>(`/tasks/systems/${encodeURIComponent(name as string)}/items`),
    enabled: name !== null,
  })
}

export function useSystems() {
  return useQuery({
    queryKey: ['systems'],
    queryFn: () => apiGet<SystemInfo[]>('/tasks/systems'),
  })
}
