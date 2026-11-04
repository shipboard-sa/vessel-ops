import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { ScheduleSnapshot } from '../../api/types'

export function useSchedule() {
  return useQuery({
    queryKey: ['schedule'],
    queryFn: () => apiGet<ScheduleSnapshot>('/schedule'),
    refetchInterval: 60_000,
  })
}
