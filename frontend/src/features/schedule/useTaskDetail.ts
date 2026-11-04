import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { SubtaskRow, TaskItemDemand } from '../../api/types'

// Lazy, per-card detail fetches - only requested once a card is expanded,
// same lazy-load pattern the Streamlit app used (an st.expander whose body
// isn't rendered until opened).
export function useTaskItemsDemand(taskId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['task-items-demand', taskId],
    queryFn: () => apiGet<TaskItemDemand[]>(`/tasks/${taskId}/items-demand`),
    enabled,
  })
}

export function useOpenSubtasks(taskId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['subtasks', taskId],
    queryFn: () => apiGet<SubtaskRow[]>(`/tasks/${taskId}/subtasks`),
    enabled,
    select: (rows) => rows.filter((r) => !r.done),
  })
}
