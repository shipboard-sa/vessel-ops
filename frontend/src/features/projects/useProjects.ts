import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { Project, ProjectPhase, ProjectTaskRow } from '../../api/types'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<Project[]>('/projects'),
  })
}

export function useProjectTasks(projectId: number | null) {
  return useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => apiGet<ProjectTaskRow[]>(`/projects/${projectId}/tasks`),
    enabled: projectId !== null,
  })
}

export function useProjectPhases(projectId: number | null) {
  return useQuery({
    queryKey: ['project-phases', projectId],
    queryFn: () => apiGet<ProjectPhase[]>(`/projects/${projectId}/phases`),
    enabled: projectId !== null,
  })
}
