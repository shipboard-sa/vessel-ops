import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { MealPlanEntry } from '../../api/types'

export function useMealPlan() {
  return useQuery({
    queryKey: ['meal-plan'],
    queryFn: () => apiGet<MealPlanEntry[]>('/meal-plan'),
  })
}
