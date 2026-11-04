import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiSend } from '../../api/client'
import type { ProjectKind, ProjectStatus } from '../../api/types'

// Assigning/releasing a task to a project changes whether it's "parked"
// (planned/cancelled projects pull their tasks out of the rolling
// schedule), so every mutation here invalidates schedule/tasks alongside
// the project-scoped queries.
function useProjectMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['project-phases'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}

export interface NewProject {
  name: string
  kind?: ProjectKind
  description?: string
  target_start?: string
  target_end?: string
}

export function useCreateProject() {
  return useProjectMutation((body: NewProject) => apiSend('POST', '/projects', body))
}

export interface ProjectEditFields {
  name?: string
  kind?: ProjectKind
  status?: ProjectStatus
  description?: string
  target_start?: string | null
  target_end?: string | null
  notes?: string
}

export function useUpdateProject() {
  return useProjectMutation(
    ({ projectId, fields }: { projectId: number; fields: ProjectEditFields }) =>
      apiSend('PATCH', `/projects/${projectId}`, fields),
  )
}

export function useDeleteProject() {
  return useProjectMutation((projectId: number) => apiSend('DELETE', `/projects/${projectId}`))
}

// null releases the task back to the rolling schedule.
export function useSetTaskProject() {
  return useProjectMutation(
    ({ taskId, projectId }: { taskId: number; projectId: number | null }) =>
      apiSend('PUT', `/tasks/${taskId}/project`, { project_id: projectId }),
  )
}

export interface NewProjectTask {
  projectId: number
  system: string
  task_name: string
  description?: string
  period?: string
  interval_type?: string
  task_kind?: string
  caution_notes?: string
  checklist_group?: string
  phase_id?: number
}

export function useCreateProjectTask() {
  return useProjectMutation(({ projectId, ...body }: NewProjectTask) =>
    apiSend('POST', '/tasks', { ...body, project_id: projectId }),
  )
}

export interface PhaseFields {
  name?: string
  notes?: string | null
  target_start?: string | null
  target_end?: string | null
}

export function useCreatePhase() {
  return useProjectMutation(({ projectId, ...body }: PhaseFields & { projectId: number; name: string }) =>
    apiSend('POST', `/projects/${projectId}/phases`, body),
  )
}

export function useUpdatePhase() {
  return useProjectMutation(({ phaseId, fields }: { phaseId: number; fields: PhaseFields }) =>
    apiSend('PATCH', `/phases/${phaseId}`, fields),
  )
}

// The phase's tasks stay on the project with no phase.
export function useDeletePhase() {
  return useProjectMutation((phaseId: number) => apiSend('DELETE', `/phases/${phaseId}`))
}

export function useReorderPhases() {
  return useProjectMutation(({ projectId, phaseIds }: { projectId: number; phaseIds: number[] }) =>
    apiSend('PUT', `/projects/${projectId}/phases/order`, { phase_ids: phaseIds }),
  )
}

// null clears the task's phase; the server refuses a phase of another project.
export function useSetTaskPhase() {
  return useProjectMutation(({ taskId, phaseId }: { taskId: number; phaseId: number | null }) =>
    apiSend('PUT', `/tasks/${taskId}/phase`, { phase_id: phaseId }),
  )
}

// A user-facing message from an ApiError (the server's `detail` text) or any Error.
export function errorText(error: unknown): string {
  if (error instanceof ApiError && typeof error.detail === 'string') return error.detail
  return error instanceof Error ? error.message : String(error)
}
